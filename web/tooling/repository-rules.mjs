// Repository policy shared by local lint and CI. Generated models are excluded
// by oxlint.config.ts because Orval owns their public re-export index.
export default {
  meta: { name: 'repository' },
  rules: {
    'no-handwritten-barrels': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          direct: 'Import directly from the defining module; do not add handwritten re-exports.',
        },
      },
      create(context) {
        return {
          ExportAllDeclaration(node) {
            context.report({ node, messageId: 'direct' })
          },
          ExportNamedDeclaration(node) {
            if (node.source) context.report({ node, messageId: 'direct' })
          },
        }
      },
    },
  },
}
