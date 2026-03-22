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

下面我简单分析一下这个方法吧，没太看懂

首先判断当前转换的节点是不是基础的元素节点或者组件节点，如果不是，那就什么都不处理

在默认情况下。动态组件、TELEPORT、SUSPENSE、svg、foreignObject 是使用 block 的

第一个处理：如果存在 props 属性，调用 buildProps 方法构建 props 的转换

所以在处理属性的时候，先将所有的静态属性全部保存起来，然后处理动态属性，这时候只是收集属性，然后开始处理属性，如果时动态的就使用 analyzePatchFlag 打标记，是否存在 class、style 等，然后还会将动态属性收录到 dynamicPropNames中。最后根据打的标记也就是你说的亮灯，算出 patchFlag，然后最后将整合后得到的完整props 对象返回

接下来处理子节点

如果当前标签节点是 keep-alive，那也应该放在 block 中，patchFlag 标记为 DYNAMIC_SLOTS，这个是时候的标记，其实还是在原来的属性基础上继续添加标记类型

## 解析 traverseNode 执行图

所以说整个 traverseNode 的逻辑就是，遍历 AST 树，在当前遍历的节点中，先循环所有的转换器，然后对当前的 node 进行转换操作，在执行这些转换器的过程中，有些转换器只是单纯的返回一个 fn，比如 transformElement、transformText，这是因为 patchFlag 发生在退出阶段。有些转换器在执行的时候就操作了节点，比如处理 if 条件的。

在处理 if 条件时，会将同等级的 if 逻辑全部拿出来整合成一个 branch 分支，并删除节点，此为一项简单的优化，这样在后续处理中，能保证一个整 block 是不变的，而里面的三元表达式根据数据去判断到底渲染出来什么。

在整个循环结束后，针对不同的类型在做处理。比如 if 逻辑，branch 中的三元是怎么处理的，就是在这个时候操作（相当于给这个黑盒变透明了，告诉最终的是什么），如果存在子节点，则处理子节点，也就是遍历递归执行当前方法。这步也就是依旧保持深度优先，也回答了我前面说的 转换 element 时为什么不继续操作子级，因为在这里子级已经操作完了。

最后再执行转换器返回的那些方法。

关于转换 element：

主要是先处理 props，对于 props 呢，先获取所有的静态属性，存起来，再获取所有的动态属性，然后处理这些属性，对于 class、style 这样的属性来说，可以特殊标记一下（亮灯策略），然后所有的动态属性还要单独存放，这个时候，根据 是否存在动态 class 或者动态的 style 动态的其他属性等等，分别标记 patchFlag，值得关注的是，得到的 patchFlag 可能包含多个类型的动态属性信息。整合成一个转换后的对象返回

将处理 props 信息拿出来，然后处理 slots，其实也就是根据各种类型的写法处理 slots 的 patchFlag

如果子节点是单个的文本，根据是否是动态文本，标记 patchFlag，其实这里的文本数据是 transformText 返回的（猜测，需要你回答是或者不是，不是的话正确的答案又是什么）

如果子节点是多个，则直接赋值就好了。

所以再 traverseNode 的过程中，绘制关系图是从高到低的，也就是深度优先，先一直往下找，直到找到叶子节点，通常是文本，也就是上面提到的单个文本。

然后完善或者说转换工作结束是从下往上的，也就是先完成子节点的转换，再完成父节点的转换，这也就是为什么处理 element 的最后能直接拿到 children 去赋值使用了

至此traverseNode分析结束了

### hoistStatic

1. 判定：谁是“死节点”？（getStaticType）
walk 递归遍历 AST 树。
动作：它会检查每一个节点。
判定标准：
没有 patchFlag（或 patchFlag 为 0）。
没有指令（v-if, v-for, v-bind）。
连带责任：如果一个 div 是静态的，但它的儿子里有一个 {{ msg }}，那这个 div 就不能被提升。因为儿子动，老子就得跟着动。
结果：只有全家都“老实”的节点，才会被标记为 PatchFlags.HOISTED (-1)。

2. 搬运：从“函数内”到“全局外”
一旦判定一个节点是 HOISTED：
动作：Vue 会把这个节点的 codegenNode 拿出来，塞进全局的 context.hoists 数组里。
画面感：这就像是把一个经常要用的零件，从“流水线”上拿下来，放进了“成品货架”。
编号：它会给这个节点一个编号，比如 _hoisted_1。
3. 生成：从“创建”变“引用”
在最后的 Generate 阶段：
以前：每次 render 都要跑一次 _createVNode("div", ...)。
现在：在 render 函数外面定义 const _hoisted_1 = _createVNode("div", ...)。然后在 render 内部，直接引用 _hoisted_1。


其实在编译器中，主要是做了以下三件事儿

第一：解析 template 模板并生成抽象语法树。在解析的过程中，会通过初始化的游标，一点点的消化 template 字符串模板，这里面除了有大量的边缘条件判断以外，更主要的就是解析 element 节点。
首先在匹配到开始标签时，会将开始标签的标签名，以及存在的属性都解析出来作为当前节点对象，然后把这个对象添加到祖先栈中，继续解析子节点，对于子节点其实也是递归处理 element。当所有的子节点都解析结束了，从祖先栈里弹出当前节点。
这一步的作用就是，能把存在嵌套关系的 template 完美的转换成树结构。
不过这时候生成的 AST 只是单纯的信息，对于动态静态属性没有任何区别

第二：转换 AST。其实就是处理这个 AST 中动态静态属性、节点，给他们打上 patchFlag 标记，静态提升标记等等。首先深度遍历 AST，对遍历到的每个节点，都执行转换器，这些转换器有的是发生在回溯节点，有的发生在开始阶段。比如 v-if 情况下，会将同级的节点整合成一个单独的 branch，这样多个合成一个节点，能达到优化的目的。转换器执行完成后，对节点进行处理，如果存在分支，则处理这个分支中的节点，如果存在子节点，则开始深度遍历子节点。在上面任务完成之后，就开始执行转换器的返回值。也就是回溯，因为在处理节点的时候是自上而下的深度递归，所以回溯的时候，是可以保证子节点处理完了才会处理父节点，然后这个时候，就开始对当前节点是否存在动态属性或者 slot，通过亮灯策略，以及动态属性类型添加 patchFlag 和 slotFlag。是否需要 block 的也会打上标记。
然后再深度检查AST，如果存在一成不变的，就打上静态标记，并移出来全局管理。目的是在后续的 patch 时，不需要比较，可以直接拿出结果渲染，而非重新创建。
最后，生成根block，这样可以保证根的快速比较，以及 block 的收集。后续就可以形成 静态、block、动态非block三种方式的 patch 了。

第三步：将处理好的 AST，生成最后的渲染字符串