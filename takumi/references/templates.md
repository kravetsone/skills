# Official Templates

Three ready-made templates ship with Takumi. Install via the shadcn CLI, or grab the raw source directly — the raw form is convenient when you want an LLM to read/adapt them in one fetch.

## Shadcn-registry install

```bash
# Blog Post
npx shadcn@latest add https://takumi.kane.tw/templates/registry/blog-post-template.json

# Docs
npx shadcn@latest add https://takumi.kane.tw/templates/registry/docs-template.json

# Product Card
npx shadcn@latest add https://takumi.kane.tw/templates/registry/product-card-template.json
```

Swap `npx shadcn@latest` for `pnpm dlx shadcn@latest`, `yarn dlx shadcn@latest`, or `bun x shadcn@latest` to match your package manager.

## Raw source — fetch via `.raw` / `raw.githubusercontent.com`

Source of truth lives in the Takumi monorepo. To read the .tsx directly (no bundler, no registry JSON wrapper):

| Template | Raw URL |
| -------- | ------- |
| Blog Post | https://raw.githubusercontent.com/kane50613/takumi/master/takumi-template/src/templates/blog-post-template.tsx |
| Docs | https://raw.githubusercontent.com/kane50613/takumi/master/takumi-template/src/templates/docs-template.tsx |
| Product Card | https://raw.githubusercontent.com/kane50613/takumi/master/takumi-template/src/templates/product-card-template.tsx |

Listing page (browsable): https://github.com/kane50613/takumi/tree/master/takumi-template/src/templates

### Useful when

- Adapting a template to your own brand without running the shadcn CLI.
- Feeding a template into an LLM to mutate (change title position, add a subtitle, swap colors).
- Diff-reading against your current OG image to see what differs structurally.

## Registry JSON — fetch via `.json`

The shadcn-flavored JSON (file list + metadata) for any template:

- https://takumi.kane.tw/templates/registry/blog-post-template.json
- https://takumi.kane.tw/templates/registry/docs-template.json
- https://takumi.kane.tw/templates/registry/product-card-template.json

Useful if you're building your own template tool that consumes shadcn-registry JSON.

## Gallery

Preview images + descriptions: https://takumi.kane.tw/docs/templates
