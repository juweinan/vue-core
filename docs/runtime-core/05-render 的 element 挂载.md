## render 中的 mountElement

```ts
const mountElement = (
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean
) => {
  let el: RendererElement
  let vnodeHook: VNodeHook | undefined | null
  const { type, props, shapeFlag, transition, patchFlag, dirs } = vnode
  if (
    !__DEV__ &&
    vnode.el &&
    hostCloneNode !== undefined &&
    patchFlag === PatchFlags.HOISTED
  ) {
    el = vnode.el = hostCloneNode(vnode.el)
  } else {
    el = vnode.el = hostCreateElement(
      vnode.type as string,
      isSVG,
      props && props.is,
      props
    )

    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      hostSetElementText(el, vnode.children as string)
    } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      mountChildren(
        vnode.children as VNodeArrayChildren,
        el,
        null,
        parentComponent,
        parentSuspense,
        isSVG && type !== 'foreignObject',
        slotScopeIds,
        optimized
      )
    }

    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, 'created')
    }
    // props
    if (props) {
      for (const key in props) {
        if (key !== 'value' && !isReservedProp(key)) {
          hostPatchProp(
            el,
            key,
            null,
            props[key],
            isSVG,
            vnode.children as VNode[],
            parentComponent,
            parentSuspense,
            unmountChildren
          )
        }
      }
      if ('value' in props) {
        hostPatchProp(el, 'value', null, props.value)
      }
      if ((vnodeHook = props.onVnodeBeforeMount)) {
        invokeVNodeHook(vnodeHook, parentComponent, vnode)
      }
    }
    setScopeId(el, vnode, vnode.scopeId, slotScopeIds, parentComponent)
  }
  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    Object.defineProperty(el, '__vnode', {
      value: vnode,
      enumerable: false
    })
    Object.defineProperty(el, '__vueParentComponent', {
      value: parentComponent,
      enumerable: false
    })
  }
  if (dirs) {
    invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
  }
  const needCallTransitionHooks =
    (!parentSuspense || (parentSuspense && !parentSuspense.pendingBranch)) &&
    transition &&
    !transition.persisted
  if (needCallTransitionHooks) {
    transition!.beforeEnter(el)
  }
  hostInsert(el, container, anchor)
  if (
    (vnodeHook = props && props.onVnodeMounted) ||
    needCallTransitionHooks ||
    dirs
  ) {
    queuePostRenderEffect(() => {
      vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
      needCallTransitionHooks && transition!.enter(el)
      dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
    }, parentSuspense)
  }
}
```

在挂载元素的逻辑中

首先判断 newVNode 中是否已经存在 el 属性了，并且还是一个纯静态的 vnode，然后就直接复制已经存在而不是创建一个新的，因为复制往往比创建更快，这也是 Vue3 中对静态节点处理的“性能外挂”了。
否则的话，就根据 vnode.type 创建一个 dom，这里调用的 hostCreateElement 就是 document.createElement(type) 方法。el 等于创建的 dom

创建完当前节点，接下来看看有没有子节点。

如果子节点是文本类型，那么就直接通过 el.textContent = text 的方式给 el 添加文本。

如果是多个子节点，调用 mountChildren 方法。其实这个方法也很简单，就是遍历子节点数组，然后把每一个子节点挂载到 el 上。这一步就相当于从头走一遍渲染 vnode。

dirs 具体是什么不清楚，但是它应该是跟生命周期有关系，此时 el 创建完了，他的 children 也已经挂载到 el 上了，所以执行 created 生命周期函数。这个 created 应该是业务代码中写的 created 钩子。

如果存在 props 属性（vnode 上的属性），循环每一个属性，调用 hostPatchProp 方法 patch。

- 如果是 class、style，那么 patch 的结果，如果有新的 prop，直接替换掉旧的，如果没有，就清空掉旧的。
- 如果是 on 事件，新旧都存在，直接替换，如果只有新的存在，通过 addEventListener 创建事件监听，如果只有旧的，则通过 removeEventListener 删除事件监听。
- 其他属性，新的没有，就移除属性，否则的话就用新的去设置属性。

这里还有个疑点，invokeVNodeHook、setScopeId 作用是什么？

执行 beforeMount 生命周期函数。

执行 hostInsert(el, container, anchor) 将 el 插入到 container 中，要求在 anchor 前面。

最后 queuePostRenderEffect 这个是个异步执行，它实际调用了 queuePostFlushCb 方法，这个方法就是在学习 watch 的时候，push 到消息队列中，然后创建 promise 那一部分的逻辑。

只不过和之前学的哪个 watch 不同的是，watch 是将 job 添加到 pre 类型的任务对了，这个是添加到 post 类型的队列。

含义是在挂载完成后执行。

所以在 render 函数中，会执行 flushPostFlushCbs 方法。这个时候就是执行了 onMounted 钩子。

## 总结

所以在挂载 element 的整个流程里，主要执行了以下内容

1. 造壳：通过 createElement 方法创建 el 元素
2. 填肉：通过 mountChildren 递归添加子元素并挂载到自身
3. 穿衣：通过 hostPatchProp 将样式属性添加到自身
4. 打标：通过 setScopeId 加上样式隔离标签
5. 上场：通过 insert 方法将 el 添加到 container 容器中
6. 庆祝：通过 post 任务队列，在挂载完成时触发 mounted 钩子