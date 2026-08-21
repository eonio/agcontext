import ts from "typescript";
import { collapseWhitespace } from "../core/text.js";
import type { Language } from "../core/types.js";

/**
 * Single-file AST analysis (phase 5). Parse-only — no type checker — which
 * keeps indexing fast enough for large repositories and incremental updates.
 * Cross-file linking happens later in the graph builder using the extracted
 * import bindings; call/inheritance/reference targets are recorded here as
 * names and resolved there. The documented trade-off vs. a full
 * `ts.createProgram`: dynamic dispatch through arbitrary expressions is not
 * resolved, while imports, direct calls, `this.` calls, `new X()`,
 * inheritance, and type references are.
 */

/** Bump to invalidate cached per-file analyses on analyzer changes. */
export const ANALYZER_VERSION = 1;

export interface CallRef {
  name: string;
  /** Receiver identifier for `recv.name(...)`; `"this"` for `this.name(...)`. */
  receiver?: string;
  isNew?: boolean;
}

export interface ImportBinding {
  local: string;
  /** Name in the target module: `"default"`, `"*"`, or an exported name. */
  imported: string;
}

export interface FileImport {
  specifier: string;
  bindings: ImportBinding[];
  typeOnly: boolean;
}

export interface ReexportedName {
  /** Name in the target module. */
  imported: string;
  /** Name on this file's public surface (differs for `export { A as B }`). */
  exported: string;
}

export interface ReexportInfo {
  specifier: string;
  /** Names re-exported from the target module, or `"*"` for star re-exports. */
  names: ReexportedName[] | "*";
}

export interface ExportBinding {
  /** Public export name (`"default"` for default exports). */
  exported: string;
  /** The local symbol path backing the export. */
  symbolPath: string;
}

export type SymbolKindName =
  "class" | "interface" | "function" | "method" | "type" | "enum" | "variable";

export interface SymbolInfo {
  /** Dotted path unique within the file, e.g. `AuthService.login`. */
  symbolPath: string;
  name: string;
  kind: SymbolKindName;
  exported: boolean;
  defaultExport: boolean;
  /** Symbol path of the containing class for methods. */
  parent?: string;
  signature: string;
  doc?: string;
  startLine: number;
  endLine: number;
  extendsNames: string[];
  implementsNames: string[];
  /** Has-a targets: property types and property `new X()` initializers. */
  compositionNames: string[];
  calls: CallRef[];
  typeRefs: string[];
}

export interface FileAnalysis {
  path: string;
  language: Language;
  loc: number;
  imports: FileImport[];
  reexports: ReexportInfo[];
  exports: ExportBinding[];
  symbols: SymbolInfo[];
  /** Calls made at module top level (side effects, bootstrap code). */
  fileCalls: CallRef[];
  fileTypeRefs: string[];
}

/** Pluggable per-language analyzer; register more via GraphPlugins. */
export interface SourceAnalyzer {
  readonly name: string;
  readonly extensions: readonly string[];
  /** Returns undefined when the file cannot be analyzed (e.g. parse crash). */
  analyze(path: string, content: string): FileAnalysis | undefined;
}

const MAX_SIGNATURE_LENGTH = 400;
const MAX_DOC_LENGTH = 280;
const MAX_TYPE_REFS_PER_SYMBOL = 120;
const MAX_SYMBOLS_PER_FILE = 2000;

interface Sink {
  calls: CallRef[];
  typeRefs: string[];
}

export class TypeScriptAnalyzer implements SourceAnalyzer {
  readonly name = "typescript";
  readonly extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

  analyze(filePath: string, content: string): FileAnalysis | undefined {
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        scriptKindFor(filePath),
      );
      return new FileVisitor(sourceFile, content, filePath).run();
    } catch {
      return undefined;
    }
  }
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return ts.ScriptKind.TS;
  }
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

class FileVisitor {
  private readonly symbols = new Map<string, SymbolInfo>();
  private readonly imports: FileImport[] = [];
  private readonly reexports: ReexportInfo[] = [];
  private readonly exportBindings: ExportBinding[] = [];
  /** `export { local as alias }` collected for the post-pass. */
  private readonly namedExportRefs: Array<{ local: string; exportedAs: string }> = [];
  /** `export default someIdentifier` collected for the post-pass. */
  private readonly defaultExportRefs: string[] = [];
  private readonly fileSink: Sink = { calls: [], typeRefs: [] };

  constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly content: string,
    private readonly filePath: string,
  ) {}

  run(): FileAnalysis {
    for (const statement of this.sourceFile.statements) {
      this.visitStatement(statement, "", true);
    }
    this.applyNamedExports();

    const symbols = [...this.symbols.values()]
      .sort((a, b) => a.startLine - b.startLine || (a.symbolPath < b.symbolPath ? -1 : 1))
      .slice(0, MAX_SYMBOLS_PER_FILE);

    for (const symbol of symbols) {
      symbol.typeRefs = dedupe(symbol.typeRefs).slice(0, MAX_TYPE_REFS_PER_SYMBOL);
      symbol.extendsNames = dedupe(symbol.extendsNames);
      symbol.implementsNames = dedupe(symbol.implementsNames);
      symbol.compositionNames = dedupe(symbol.compositionNames);
    }

    const language: Language = /\.(ts|tsx|mts|cts)$/i.test(this.filePath) ? "ts" : "js";
    return {
      path: this.filePath,
      language,
      loc: this.sourceFile.getLineStarts().length,
      imports: this.imports,
      reexports: this.reexports,
      exports: this.exportBindings,
      symbols,
      fileCalls: this.fileSink.calls,
      fileTypeRefs: dedupe(this.fileSink.typeRefs).slice(0, MAX_TYPE_REFS_PER_SYMBOL),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Statement dispatch                                                  */
  /* ------------------------------------------------------------------ */

  private visitStatement(statement: ts.Statement, prefix: string, topLevel: boolean): void {
    if (ts.isImportDeclaration(statement)) {
      this.handleImport(statement);
    } else if (ts.isExportDeclaration(statement)) {
      this.handleExportDeclaration(statement);
    } else if (ts.isExportAssignment(statement)) {
      this.handleExportAssignment(statement);
    } else if (ts.isClassDeclaration(statement)) {
      this.handleClass(statement, prefix, topLevel);
    } else if (ts.isInterfaceDeclaration(statement)) {
      this.handleInterface(statement, prefix, topLevel);
    } else if (ts.isFunctionDeclaration(statement)) {
      this.handleFunction(statement, prefix, topLevel);
    } else if (ts.isVariableStatement(statement)) {
      this.handleVariableStatement(statement, prefix, topLevel);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      this.handleTypeAlias(statement, prefix, topLevel);
    } else if (ts.isEnumDeclaration(statement)) {
      this.handleEnum(statement, prefix, topLevel);
    } else if (ts.isModuleDeclaration(statement)) {
      this.handleNamespace(statement, prefix, topLevel);
    } else {
      // Top-level side effects (bootstrap calls, app.listen(), ...) feed file signals.
      this.collectBody(statement, this.fileSink);
    }
  }

  private handleImport(node: ts.ImportDeclaration): void {
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const specifier = node.moduleSpecifier.text;
    const bindings: ImportBinding[] = [];
    const clause = node.importClause;
    if (clause?.name) bindings.push({ local: clause.name.text, imported: "default" });
    if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        bindings.push({ local: clause.namedBindings.name.text, imported: "*" });
      } else {
        for (const element of clause.namedBindings.elements) {
          bindings.push({
            local: element.name.text,
            imported: (element.propertyName ?? element.name).text,
          });
        }
      }
    }
    this.imports.push({ specifier, bindings, typeOnly: clause?.isTypeOnly ?? false });
  }

  private handleExportDeclaration(node: ts.ExportDeclaration): void {
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const names =
        node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map((el) => ({
              imported: (el.propertyName ?? el.name).text,
              exported: el.name.text,
            }))
          : ("*" as const);
      this.reexports.push({ specifier: node.moduleSpecifier.text, names });
      return;
    }
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        this.namedExportRefs.push({
          local: (element.propertyName ?? element.name).text,
          exportedAs: element.name.text,
        });
      }
    }
  }

  private handleExportAssignment(node: ts.ExportAssignment): void {
    if (ts.isIdentifier(node.expression)) {
      this.defaultExportRefs.push(node.expression.text);
    } else {
      this.collectBody(node.expression, this.fileSink);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Declarations                                                        */
  /* ------------------------------------------------------------------ */

  private handleClass(node: ts.ClassDeclaration, prefix: string, topLevel: boolean): void {
    const name = node.name?.text ?? "default";
    const symbolPath = prefix + name;
    const exported = topLevel && this.hasExportModifier(node);
    const defaultExport = exported && this.hasDefaultModifier(node);

    const extendsNames: string[] = [];
    const implementsNames: string[] = [];
    for (const heritage of node.heritageClauses ?? []) {
      for (const typeExpr of heritage.types) {
        const text = typeExpr.expression.getText(this.sourceFile);
        if (heritage.token === ts.SyntaxKind.ExtendsKeyword) extendsNames.push(text);
        else implementsNames.push(text);
      }
    }

    const classInfo: SymbolInfo = {
      symbolPath,
      name,
      kind: "class",
      exported,
      defaultExport,
      signature: this.sliceSignature(node.getStart(this.sourceFile), node.members.pos - 1),
      startLine: this.lineOf(node.getStart(this.sourceFile)),
      endLine: this.lineOf(node.end),
      extendsNames,
      implementsNames,
      compositionNames: [],
      calls: [],
      typeRefs: [...extendsNames, ...implementsNames],
    };
    const doc = this.docOf(node);
    if (doc) classInfo.doc = doc;
    this.addSymbol(classInfo);
    if (exported) this.addExportBinding(defaultExport ? "default" : name, symbolPath);

    for (const member of node.members) {
      this.handleClassMember(member, classInfo);
    }
  }

  private handleClassMember(member: ts.ClassElement, classInfo: SymbolInfo): void {
    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member) ||
      ts.isConstructorDeclaration(member)
    ) {
      const methodName = ts.isConstructorDeclaration(member)
        ? "constructor"
        : this.propertyNameText(member.name);
      const sink: Sink = { calls: [], typeRefs: [] };
      for (const param of member.parameters) {
        if (param.type) this.collectTypeNode(param.type, sink.typeRefs);
        // Constructor parameter properties (`constructor(private db: Database)`)
        // declare composition just like property declarations do.
        if (
          ts.isConstructorDeclaration(member) &&
          this.isParameterProperty(param) &&
          param.type &&
          ts.isTypeReferenceNode(param.type)
        ) {
          classInfo.compositionNames.push(param.type.typeName.getText(this.sourceFile));
        }
      }
      if (member.type) this.collectTypeNode(member.type, sink.typeRefs);
      if (member.body) this.collectBody(member.body, sink);

      const info: SymbolInfo = {
        symbolPath: `${classInfo.symbolPath}.${methodName}`,
        name: methodName,
        kind: "method",
        exported: classInfo.exported,
        defaultExport: false,
        parent: classInfo.symbolPath,
        signature: this.sliceSignature(
          member.getStart(this.sourceFile),
          member.body ? member.body.getStart(this.sourceFile) : member.end,
        ),
        startLine: this.lineOf(member.getStart(this.sourceFile)),
        endLine: this.lineOf(member.end),
        extendsNames: [],
        implementsNames: [],
        compositionNames: [],
        calls: sink.calls,
        typeRefs: sink.typeRefs,
      };
      const doc = this.docOf(member);
      if (doc) info.doc = doc;
      this.addSymbol(info);
      return;
    }

    if (ts.isPropertyDeclaration(member)) {
      if (member.type && ts.isTypeReferenceNode(member.type)) {
        classInfo.compositionNames.push(member.type.typeName.getText(this.sourceFile));
      }
      if (member.type) this.collectTypeNode(member.type, classInfo.typeRefs);
      const initializer = member.initializer;
      if (!initializer) return;
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        // Arrow-function class fields are methods in every practical sense.
        const methodName = this.propertyNameText(member.name);
        const sink: Sink = { calls: [], typeRefs: [] };
        this.collectBody(initializer.body, sink);
        for (const param of initializer.parameters) {
          if (param.type) this.collectTypeNode(param.type, sink.typeRefs);
        }
        const info: SymbolInfo = {
          symbolPath: `${classInfo.symbolPath}.${methodName}`,
          name: methodName,
          kind: "method",
          exported: classInfo.exported,
          defaultExport: false,
          parent: classInfo.symbolPath,
          signature: this.sliceSignature(
            member.getStart(this.sourceFile),
            initializer.body.getStart(this.sourceFile),
          ),
          startLine: this.lineOf(member.getStart(this.sourceFile)),
          endLine: this.lineOf(member.end),
          extendsNames: [],
          implementsNames: [],
          compositionNames: [],
          calls: sink.calls,
          typeRefs: sink.typeRefs,
        };
        const doc = this.docOf(member);
        if (doc) info.doc = doc;
        this.addSymbol(info);
        return;
      }
      if (ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression)) {
        classInfo.compositionNames.push(initializer.expression.text);
        classInfo.calls.push({ name: initializer.expression.text, isNew: true });
        return;
      }
      this.collectBody(initializer, { calls: classInfo.calls, typeRefs: classInfo.typeRefs });
    }
  }

  private handleInterface(node: ts.InterfaceDeclaration, prefix: string, topLevel: boolean): void {
    const name = node.name.text;
    const symbolPath = prefix + name;
    const exported = topLevel && this.hasExportModifier(node);
    const extendsNames: string[] = [];
    for (const heritage of node.heritageClauses ?? []) {
      for (const typeExpr of heritage.types) {
        extendsNames.push(typeExpr.expression.getText(this.sourceFile));
      }
    }
    const typeRefs: string[] = [...extendsNames];
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.type) {
        this.collectTypeNode(member.type, typeRefs);
      } else if (ts.isMethodSignature(member)) {
        for (const param of member.parameters) {
          if (param.type) this.collectTypeNode(param.type, typeRefs);
        }
        if (member.type) this.collectTypeNode(member.type, typeRefs);
      }
    }
    const info: SymbolInfo = {
      symbolPath,
      name,
      kind: "interface",
      exported,
      defaultExport: false,
      signature: this.sliceSignature(node.getStart(this.sourceFile), node.members.pos - 1),
      startLine: this.lineOf(node.getStart(this.sourceFile)),
      endLine: this.lineOf(node.end),
      extendsNames,
      implementsNames: [],
      compositionNames: [],
      calls: [],
      typeRefs,
    };
    const doc = this.docOf(node);
    if (doc) info.doc = doc;
    this.addSymbol(info);
    if (exported) this.addExportBinding(name, symbolPath);
  }

  private handleFunction(node: ts.FunctionDeclaration, prefix: string, topLevel: boolean): void {
    const name = node.name?.text ?? "default";
    const symbolPath = prefix + name;
    const exported = topLevel && this.hasExportModifier(node);
    const defaultExport = exported && this.hasDefaultModifier(node);
    const sink: Sink = { calls: [], typeRefs: [] };
    for (const param of node.parameters) {
      if (param.type) this.collectTypeNode(param.type, sink.typeRefs);
    }
    if (node.type) this.collectTypeNode(node.type, sink.typeRefs);
    if (node.body) this.collectBody(node.body, sink);

    const info: SymbolInfo = {
      symbolPath,
      name,
      kind: "function",
      exported,
      defaultExport,
      signature: this.sliceSignature(
        node.getStart(this.sourceFile),
        node.body ? node.body.getStart(this.sourceFile) : node.end,
      ),
      startLine: this.lineOf(node.getStart(this.sourceFile)),
      endLine: this.lineOf(node.end),
      extendsNames: [],
      implementsNames: [],
      compositionNames: [],
      calls: sink.calls,
      typeRefs: sink.typeRefs,
    };
    const doc = this.docOf(node);
    if (doc) info.doc = doc;
    this.addSymbol(info);
    if (exported) this.addExportBinding(defaultExport ? "default" : name, symbolPath);
  }

  private handleVariableStatement(
    node: ts.VariableStatement,
    prefix: string,
    topLevel: boolean,
  ): void {
    const exported = topLevel && this.hasExportModifier(node);
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        if (declaration.initializer) this.collectBody(declaration.initializer, this.fileSink);
        continue;
      }
      const name = declaration.name.text;
      const symbolPath = prefix + name;
      const initializer = declaration.initializer;

      // CommonJS-style `const x = require("...")` becomes an import binding.
      if (
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === "require" &&
        initializer.arguments.length === 1 &&
        initializer.arguments[0] !== undefined &&
        ts.isStringLiteral(initializer.arguments[0])
      ) {
        this.imports.push({
          specifier: initializer.arguments[0].text,
          bindings: [{ local: name, imported: "*" }],
          typeOnly: false,
        });
        continue;
      }

      if (
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        const sink: Sink = { calls: [], typeRefs: [] };
        for (const param of initializer.parameters) {
          if (param.type) this.collectTypeNode(param.type, sink.typeRefs);
        }
        if (initializer.type) this.collectTypeNode(initializer.type, sink.typeRefs);
        this.collectBody(initializer.body, sink);
        const info: SymbolInfo = {
          symbolPath,
          name,
          kind: "function",
          exported,
          defaultExport: false,
          signature: this.sliceSignature(
            declaration.getStart(this.sourceFile),
            initializer.body.getStart(this.sourceFile),
          ),
          startLine: this.lineOf(declaration.getStart(this.sourceFile)),
          endLine: this.lineOf(declaration.end),
          extendsNames: [],
          implementsNames: [],
          compositionNames: [],
          calls: sink.calls,
          typeRefs: sink.typeRefs,
        };
        const doc = this.docOf(node);
        if (doc) info.doc = doc;
        this.addSymbol(info);
        if (exported) this.addExportBinding(name, symbolPath);
        continue;
      }

      if (!exported) {
        // Unexported plain values only feed file-level signals.
        if (initializer) this.collectBody(initializer, this.fileSink);
        continue;
      }

      const sink: Sink = { calls: [], typeRefs: [] };
      if (declaration.type) this.collectTypeNode(declaration.type, sink.typeRefs);
      const compositionNames: string[] = [];
      if (initializer) {
        if (ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression)) {
          compositionNames.push(initializer.expression.text);
          sink.calls.push({ name: initializer.expression.text, isNew: true });
        } else {
          this.collectBody(initializer, sink);
        }
      }
      const end = Math.min(declaration.end, declaration.getStart(this.sourceFile) + 600);
      const info: SymbolInfo = {
        symbolPath,
        name,
        kind: "variable",
        exported,
        defaultExport: false,
        signature: this.sliceSignature(declaration.getStart(this.sourceFile), end),
        startLine: this.lineOf(declaration.getStart(this.sourceFile)),
        endLine: this.lineOf(declaration.end),
        extendsNames: [],
        implementsNames: [],
        compositionNames,
        calls: sink.calls,
        typeRefs: sink.typeRefs,
      };
      const doc = this.docOf(node);
      if (doc) info.doc = doc;
      this.addSymbol(info);
      this.addExportBinding(name, symbolPath);
    }
  }

  private handleTypeAlias(node: ts.TypeAliasDeclaration, prefix: string, topLevel: boolean): void {
    const name = node.name.text;
    const symbolPath = prefix + name;
    const exported = topLevel && this.hasExportModifier(node);
    const typeRefs: string[] = [];
    this.collectTypeNode(node.type, typeRefs);
    const info: SymbolInfo = {
      symbolPath,
      name,
      kind: "type",
      exported,
      defaultExport: false,
      signature: this.sliceSignature(
        node.getStart(this.sourceFile),
        Math.min(node.end, node.getStart(this.sourceFile) + 600),
      ),
      startLine: this.lineOf(node.getStart(this.sourceFile)),
      endLine: this.lineOf(node.end),
      extendsNames: [],
      implementsNames: [],
      compositionNames: [],
      calls: [],
      typeRefs,
    };
    const doc = this.docOf(node);
    if (doc) info.doc = doc;
    this.addSymbol(info);
    if (exported) this.addExportBinding(name, symbolPath);
  }

  private handleEnum(node: ts.EnumDeclaration, prefix: string, topLevel: boolean): void {
    const name = node.name.text;
    const symbolPath = prefix + name;
    const exported = topLevel && this.hasExportModifier(node);
    const info: SymbolInfo = {
      symbolPath,
      name,
      kind: "enum",
      exported,
      defaultExport: false,
      signature: `enum ${name} (${node.members.length} members)`,
      startLine: this.lineOf(node.getStart(this.sourceFile)),
      endLine: this.lineOf(node.end),
      extendsNames: [],
      implementsNames: [],
      compositionNames: [],
      calls: [],
      typeRefs: [],
    };
    const doc = this.docOf(node);
    if (doc) info.doc = doc;
    this.addSymbol(info);
    if (exported) this.addExportBinding(name, symbolPath);
  }

  private handleNamespace(node: ts.ModuleDeclaration, prefix: string, topLevel: boolean): void {
    if (!node.body || !ts.isModuleBlock(node.body) || !ts.isIdentifier(node.name)) return;
    const namespaceExported = topLevel && this.hasExportModifier(node);
    const childPrefix = `${prefix}${node.name.text}.`;
    for (const statement of node.body.statements) {
      // Members are only file-exported when the namespace itself is exported;
      // visitStatement's `topLevel` flag carries that through.
      this.visitStatement(statement, childPrefix, namespaceExported);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Collection helpers                                                  */
  /* ------------------------------------------------------------------ */

  private collectBody(node: ts.Node, sink: Sink): void {
    const visit = (current: ts.Node): void => {
      if (ts.isCallExpression(current)) {
        const callee = current.expression;
        if (ts.isIdentifier(callee)) {
          sink.calls.push({ name: callee.text });
        } else if (ts.isPropertyAccessExpression(callee)) {
          const receiver = this.receiverText(callee.expression);
          if (receiver !== undefined) {
            sink.calls.push({ name: callee.name.text, receiver });
          } else {
            sink.calls.push({ name: callee.name.text });
          }
        }
      } else if (ts.isNewExpression(current)) {
        const callee = current.expression;
        if (ts.isIdentifier(callee)) {
          sink.calls.push({ name: callee.text, isNew: true });
        } else if (ts.isPropertyAccessExpression(callee)) {
          const receiver = this.receiverText(callee.expression);
          if (receiver !== undefined) {
            sink.calls.push({ name: callee.name.text, receiver, isNew: true });
          } else {
            sink.calls.push({ name: callee.name.text, isNew: true });
          }
        }
      } else if (ts.isTypeReferenceNode(current)) {
        sink.typeRefs.push(current.typeName.getText(this.sourceFile));
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
  }

  private collectTypeNode(typeNode: ts.TypeNode, refs: string[]): void {
    const visit = (current: ts.Node): void => {
      if (ts.isTypeReferenceNode(current)) {
        refs.push(current.typeName.getText(this.sourceFile));
      }
      ts.forEachChild(current, visit);
    };
    visit(typeNode);
  }

  private receiverText(expression: ts.Expression): string | undefined {
    if (ts.isIdentifier(expression)) return expression.text;
    if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
    return undefined;
  }

  /* ------------------------------------------------------------------ */
  /* Bookkeeping                                                         */
  /* ------------------------------------------------------------------ */

  private addSymbol(info: SymbolInfo): void {
    const existing = this.symbols.get(info.symbolPath);
    if (!existing) {
      this.symbols.set(info.symbolPath, info);
      return;
    }
    // Overload signatures / declaration merging: keep the first entry, merge
    // behavioral data, and extend the covered range.
    existing.endLine = Math.max(existing.endLine, info.endLine);
    existing.exported = existing.exported || info.exported;
    existing.calls.push(...info.calls);
    existing.typeRefs.push(...info.typeRefs);
    existing.extendsNames.push(...info.extendsNames);
    existing.implementsNames.push(...info.implementsNames);
    existing.compositionNames.push(...info.compositionNames);
    if (!existing.doc && info.doc) existing.doc = info.doc;
  }

  private addExportBinding(exported: string, symbolPath: string): void {
    if (!this.exportBindings.some((b) => b.exported === exported)) {
      this.exportBindings.push({ exported, symbolPath });
    }
  }

  private applyNamedExports(): void {
    for (const ref of this.namedExportRefs) {
      const symbol = this.findTopLevelByName(ref.local);
      if (symbol) {
        symbol.exported = true;
        this.addExportBinding(ref.exportedAs, symbol.symbolPath);
      }
    }
    for (const local of this.defaultExportRefs) {
      const symbol = this.findTopLevelByName(local);
      if (symbol) {
        symbol.exported = true;
        symbol.defaultExport = true;
        this.addExportBinding("default", symbol.symbolPath);
      }
    }
  }

  private findTopLevelByName(name: string): SymbolInfo | undefined {
    for (const symbol of this.symbols.values()) {
      if (symbol.parent === undefined && symbol.name === name) return symbol;
    }
    return undefined;
  }

  private hasExportModifier(node: ts.HasModifiers): boolean {
    return ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  private hasDefaultModifier(node: ts.HasModifiers): boolean {
    return ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }

  private isParameterProperty(param: ts.ParameterDeclaration): boolean {
    return (
      ts
        .getModifiers(param)
        ?.some(
          (m) =>
            m.kind === ts.SyntaxKind.PublicKeyword ||
            m.kind === ts.SyntaxKind.PrivateKeyword ||
            m.kind === ts.SyntaxKind.ProtectedKeyword ||
            m.kind === ts.SyntaxKind.ReadonlyKeyword,
        ) ?? false
    );
  }

  private propertyNameText(name: ts.PropertyName): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    return collapseWhitespace(name.getText(this.sourceFile)).slice(0, 60);
  }

  private lineOf(position: number): number {
    return this.sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  }

  private sliceSignature(start: number, end: number): string {
    const safeEnd = Math.max(start, Math.min(end, this.content.length));
    let signature = collapseWhitespace(this.content.slice(start, safeEnd));
    if (signature.endsWith("=>")) signature = signature.slice(0, -2).trimEnd();
    if (signature.endsWith("{")) signature = signature.slice(0, -1).trimEnd();
    return signature.slice(0, MAX_SIGNATURE_LENGTH);
  }

  private docOf(node: ts.Node): string | undefined {
    const ranges = ts.getLeadingCommentRanges(this.content, node.getFullStart());
    if (!ranges) return undefined;
    for (let i = ranges.length - 1; i >= 0; i--) {
      const range = ranges[i];
      if (!range) continue;
      const text = this.content.slice(range.pos, range.end);
      if (!text.startsWith("/**")) continue;
      return cleanJsDoc(text);
    }
    return undefined;
  }
}

function cleanJsDoc(raw: string): string | undefined {
  const lines = raw
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd());
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@")) break;
    if (line.length === 0 && kept.length > 0) break;
    if (line.length > 0) kept.push(line);
  }
  const doc = collapseWhitespace(kept.join(" "));
  return doc.length > 0 ? doc.slice(0, MAX_DOC_LENGTH) : undefined;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
