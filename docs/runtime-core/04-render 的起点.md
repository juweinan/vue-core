## render 函数的起点

```ts
const render: RootRenderFunction = (vnode, container, isSVG) => {
  if (vnode == null) {
    if (container._vnode) {
      unmount(container._vnode, null, null, true)
    }
  } else {
    patch(container._vnode || null, vnode, container, null, null, null, isSVG)
  }
  flushPostFlushCbs()
  container._vnode = vnode
}
```

上面代码中，是 render 方法的主函数。

首先判断需要渲染的 vnode 是不是存在：

- 如果不存在，并且 container 上有旧的 `_vnode`，那么说明这是卸载的操作，执行 unmount。
- 如果存在，则调用 patch 方法，将 oldVNode（`container._vnode`）和 newVNode（vnode）传递进去，开始比较。

不管是卸载还是挂载还是更新操作，全部执行结束后，也就是页面更新完成了，调用 flushPostFlushCbs 方法，这个方法在 watch 的实现中见过，它主要含义是执行所有挂载之后的 job，最后，将 vnode 作为 oldVNode 添加到 `container._vnode` 属性上。

## unmount

这里简单说一下这个方法里面的逻辑

1. 删除掉 ref 属性值，将 ref 设置为 null，这样页面在通过 ref 访问的时候，就发现访问不到了（可以理解为解除 ref 和 dom 的关联。
2. 如果 vnode 是 keep-alive 的，只需要让组件失活即可，不需要执行后面的卸载工作。
3. 如果需要唤醒 vnode 生命周期函数，并且存在 BeforeUnmount 周期函数，则执行它
4. 如果是组件，调用 unmountComponent 卸载组件（方法里面也是执行证明周期，还有对异步组件的处理，没太看明白）
5. 执行 beforeUnmount 生命周期方法
6. 还有根据 patchFlag 快速删除
7. 等等...

说实在的，细看看不明白，但是大概知道什么意思

## patch

这个方法其实就是对比新旧 vnode，并且根据 vnode 的信息，做出对应的处理了。
算是 patch 整个功能的入口。

```ts
const patch: PatchFn = (
  n1,
  n2,
  container,
  anchor = null,
  parentComponent = null,
  parentSuspense = null,
  isSVG = false,
  slotScopeIds = null,
  optimized = __DEV__ && isHmrUpdating ? false : !!n2.dynamicChildren
) => {
  if (n1 === n2) {
    return
  }

  if (n1 && !isSameVNodeType(n1, n2)) {
    anchor = getNextHostNode(n1)
    unmount(n1, parentComponent, parentSuspense, true)
    n1 = null
  }

  if (n2.patchFlag === PatchFlags.BAIL) {
    optimized = false
    n2.dynamicChildren = null
  }

  const { type, ref, shapeFlag } = n2
  switch (type) {
    case Text:
      processText(n1, n2, container, anchor)
      break
    case Comment:
      processCommentNode(n1, n2, container, anchor)
      break
    case Static:
      if (n1 == null) {
        mountStaticNode(n2, container, anchor, isSVG)
      } else if (__DEV__) {
        patchStaticNode(n1, n2, container, isSVG)
      }
      break
    case Fragment:
      processFragment(
        n1,
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
      break
    default:
      if (shapeFlag & ShapeFlags.ELEMENT) {
        processElement(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      } else if (shapeFlag & ShapeFlags.COMPONENT) {
        processComponent(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      } else if (shapeFlag & ShapeFlags.TELEPORT) {
        ;(type as typeof TeleportImpl).process(
          n1 as TeleportVNode,
          n2 as TeleportVNode,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized,
          internals
        )
      } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
        ;(type as typeof SuspenseImpl).process(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized,
          internals
        )
      } else if (__DEV__) {
        warn('Invalid VNode type:', type, `(${typeof type})`)
      }
  }

  if (ref != null && parentComponent) {
    setRef(ref, n1 && n1.ref, parentSuspense, n2 || n1, !n2)
  }
}
```

一点点分析...

首先判断 oldVNode 和 newVNode 是不是相等的，如果相等的，说明没有发生任何变化，那么也就不需要做任何处理，直接返回。

如果存在 oldVNode，但是跟 newVNode 的 type 或绑定的 key 不一样。
这说明标签名发生了变化，或者是 key 发生了变化。
通常在这种情况，可以理解为 newVNode 需要完全代替掉 oldVNode，因为他们最基本的都变了。
满足上述情况，则获取 oldVNode 的位置，并且卸载并清空掉 oldVNode。这样后面对 newVNode 只需要执行挂载即可。

如果 newVNode 的 patchFlag 表示需要跳过 Vue 的 Diff 优化更新，而是需要全量比较，则 newVNode 的动态 children 就设置为空。

然后根据 newVNode 的类型，shapeFlag 开始决定要做什么类型的操作。

#### 文本类型

如果 oldVNode 不存在，通过 doc.createTextNode(text) 创建文本节点，然后再通过 parent.insertBefore(child, anchor || null) 将文本节点添加到 container 容器中，并且还要再 anchor 的前面。

如果 oldVNode 存在，并且新旧 vnode 的文本不一样，则直接把新的文本更新到 oldVNode 的 el 上。

其实这些最终都是调用原生的操作 DOM 的方法。

操作 DOM 方法都写在 `/packages/runtime-dom/src/nodeOps.ts` 中。

注释节点、静态节点就不说了

#### ELEMENT 元素节点

```ts
if (shapeFlag & ShapeFlags.ELEMENT) {
  if (n1 == null) {
    mountElement()
  } else {
    patchElement()
  }
}
```

这里有这么一个判断，因为在生成 vnode 的时候，shapeFlag 是通过 vnode.type | children.type 得到的，所以这里如果得到一个为真的值，那么说明 shapeFlag 中包含了 ELEMENT 元素节点。

然后执行 processElement，详细查看 

05-render 的 element 挂载.md
06-render 的 element 补丁.md