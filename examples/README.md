# AGContext Examples

Each example is a standalone script or config you can copy into a project
that has `@eonio/agcontext` installed.

| Example                               | Shows                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| [`basic/`](basic)                     | Index a repository, retrieve, and print an assembled context package               |
| [`advanced-config/`](advanced-config) | A fully tuned `agcontext.config.ts`                                                |
| [`custom-plugin/`](custom-plugin)     | A RankingPlugin + CompressionPlugin adding a custom signal and summary annotations |

Running the basic example against any repository:

```bash
npm install @eonio/agcontext
node examples/basic/main.mjs /path/to/some/repo "how does authentication work"
```
