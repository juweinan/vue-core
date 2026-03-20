```ts
export function transform(root: RootNode, options: TransformOptions) {
  const context = createTransformContext(root, options)
  traverseNode(root, context)
  if (options.hoistStatic) {
    hoistStatic(root, context)
  }
  if (!options.ssr) {
    createRootCodegen(root, context)
  }
  root.helpers = [...context.helpers.keys()]
  root.components = [...context.components]
  root.directives = [...context.directives]
  root.imports = context.imports
  root.hoists = context.hoists
  root.temps = context.temps
  root.cached = context.cached
}
```

首先根据 AST 和 options 配置参数创建一个上下文（里面包含了很多参数）用到的时候再说

然后执行 traverseNode(root, context) 方法，这个方法就是遍历 AST。

```ts
export function traverseNode(
  node: RootNode | TemplateChildNode,
  context: TransformContext
) {
  context.currentNode = node
  const { nodeTransforms } = context
  const exitFns = []
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) {
      if (isArray(onExit)) {
        exitFns.push(...onExit)
      } else {
        exitFns.push(onExit)
      }
    }
    if (!context.currentNode) {
      return
    } else {
      node = context.currentNode
    }
  }
}
```

这是一个很重要的方法，首先将当前遍历的节点缓存到 context.currentNode 属性上。
然后在上下文找到 nodeTransforms，也就是 node 的转换器方法，遍历这个数组并执行每个转换器方法，参数是当前的 node 和 context。

如果执行完转换器方法还存在一个 onExit，就存起来。下面还有个判断，context.currentNode如果不存在，直接返回，这是说明这个node被删除掉了，还有一种可能是 node 被替换掉了，之所以发生这种变化，是因为在转换器中做了什么操作。

下面就先看一下所有的转换器

transformElement

执行这个函数就是返回一个新的函数，除此以外，函数本身没有任何逻辑
