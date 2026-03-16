import {
  Text,
  Fragment,
  Comment,
  cloneIfMounted,
  normalizeVNode,
  VNode,
  VNodeArrayChildren,
  createVNode,
  isSameVNodeType,
  Static,
  VNodeHook,
  VNodeProps,
  invokeVNodeHook
} from './vnode'
import {
  ComponentInternalInstance,
  ComponentOptions,
  createComponentInstance,
  Data,
  setupComponent
} from './component'
import {
  filterSingleRoot,
  renderComponentRoot,
  shouldUpdateComponent,
  updateHOCHostEl
} from './componentRenderUtils'
import {
  EMPTY_OBJ,
  EMPTY_ARR,
  isReservedProp,
  PatchFlags,
  ShapeFlags,
  NOOP,
  invokeArrayFns,
  isArray,
  getGlobalThis
} from '@vue/shared'
import {
  queueJob,
  queuePostFlushCb,
  flushPostFlushCbs,
  invalidateJob,
  flushPreFlushCbs,
  SchedulerJob
} from './scheduler'
import { pauseTracking, resetTracking, ReactiveEffect } from '@vue/reactivity'
import { updateProps } from './componentProps'
import { updateSlots } from './componentSlots'
import { pushWarningContext, popWarningContext, warn } from './warning'
import { createAppAPI, CreateAppFunction } from './apiCreateApp'
import { setRef } from './rendererTemplateRef'
import {
  SuspenseBoundary,
  queueEffectWithSuspense,
  SuspenseImpl
} from './components/Suspense'
import { TeleportImpl, TeleportVNode } from './components/Teleport'
import { isKeepAlive, KeepAliveContext } from './components/KeepAlive'
import { registerHMR, unregisterHMR, isHmrUpdating } from './hmr'
import { createHydrationFunctions, RootHydrateFunction } from './hydration'
import { invokeDirectiveHook } from './directives'
import { startMeasure, endMeasure } from './profiling'
import {
  devtoolsComponentAdded,
  devtoolsComponentRemoved,
  devtoolsComponentUpdated,
  setDevtoolsHook
} from './devtools'
import { initFeatureFlags } from './featureFlags'
import { isAsyncWrapper } from './apiAsyncComponent'
import { isCompatEnabled } from './compat/compatConfig'
import { DeprecationTypes } from './compat/compatConfig'

export interface Renderer<HostElement = RendererElement> {
  render: RootRenderFunction<HostElement>
  createApp: CreateAppFunction<HostElement>
}

export interface HydrationRenderer extends Renderer<Element | ShadowRoot> {
  hydrate: RootHydrateFunction
}

export type RootRenderFunction<HostElement = RendererElement> = (
  vnode: VNode | null,
  container: HostElement,
  isSVG?: boolean
) => void

export interface RendererOptions<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  patchProp(
    el: HostElement,
    key: string,
    prevValue: any,
    nextValue: any,
    isSVG?: boolean,
    prevChildren?: VNode<HostNode, HostElement>[],
    parentComponent?: ComponentInternalInstance | null,
    parentSuspense?: SuspenseBoundary | null,
    unmountChildren?: UnmountChildrenFn
  ): void
  insert(el: HostNode, parent: HostElement, anchor?: HostNode | null): void
  remove(el: HostNode): void
  createElement(
    type: string,
    isSVG?: boolean,
    isCustomizedBuiltIn?: string,
    vnodeProps?: (VNodeProps & { [key: string]: any }) | null
  ): HostElement
  createText(text: string): HostNode
  createComment(text: string): HostNode
  setText(node: HostNode, text: string): void
  setElementText(node: HostElement, text: string): void
  parentNode(node: HostNode): HostElement | null
  nextSibling(node: HostNode): HostNode | null
  querySelector?(selector: string): HostElement | null
  setScopeId?(el: HostElement, id: string): void
  cloneNode?(node: HostNode): HostNode
  insertStaticContent?(
    content: string,
    parent: HostElement,
    anchor: HostNode | null,
    isSVG: boolean,
    start?: HostNode | null,
    end?: HostNode | null
  ): [HostNode, HostNode]
}

// Renderer Node can technically be any object in the context of core renderer
// logic - they are never directly operated on and always passed to the node op
// functions provided via options, so the internal constraint is really just
// a generic object.
export interface RendererNode {
  [key: string]: any
}

export interface RendererElement extends RendererNode {}

// An object exposing the internals of a renderer, passed to tree-shakeable
// features so that they can be decoupled from this file. Keys are shortened
// to optimize bundle size.
export interface RendererInternals<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  p: PatchFn
  um: UnmountFn
  r: RemoveFn
  m: MoveFn
  mt: MountComponentFn
  mc: MountChildrenFn
  pc: PatchChildrenFn
  pbc: PatchBlockChildrenFn
  n: NextFn
  o: RendererOptions<HostNode, HostElement>
}

// These functions are created inside a closure and therefore their types cannot
// be directly exported. In order to avoid maintaining function signatures in
// two places, we declare them once here and use them inside the closure.
type PatchFn = (
  n1: VNode | null, // null means this is a mount
  n2: VNode,
  container: RendererElement,
  anchor?: RendererNode | null,
  parentComponent?: ComponentInternalInstance | null,
  parentSuspense?: SuspenseBoundary | null,
  isSVG?: boolean,
  slotScopeIds?: string[] | null,
  optimized?: boolean
) => void

type MountChildrenFn = (
  children: VNodeArrayChildren,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  start?: number
) => void

type PatchChildrenFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean
) => void

type PatchBlockChildrenFn = (
  oldChildren: VNode[],
  newChildren: VNode[],
  fallbackContainer: RendererElement,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null
) => void

type MoveFn = (
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  type: MoveType,
  parentSuspense?: SuspenseBoundary | null
) => void

type NextFn = (vnode: VNode) => RendererNode | null

type UnmountFn = (
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  optimized?: boolean
) => void

type RemoveFn = (vnode: VNode) => void

type UnmountChildrenFn = (
  children: VNode[],
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  optimized?: boolean,
  start?: number
) => void

export type MountComponentFn = (
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

type ProcessTextOrCommentFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null
) => void

export type SetupRenderEffectFn = (
  instance: ComponentInternalInstance,
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

export const enum MoveType {
  ENTER,
  LEAVE,
  REORDER
}

export const queuePostRenderEffect = __FEATURE_SUSPENSE__
  ? queueEffectWithSuspense
  : queuePostFlushCb

/**
 * The createRenderer function accepts two generic arguments:
 * HostNode and HostElement, corresponding to Node and Element types in the
 * host environment. For example, for runtime-dom, HostNode would be the DOM
 * `Node` interface and HostElement would be the DOM `Element` interface.
 *
 * Custom renderers can pass in the platform specific types like this:
 *
 * ``` js
 * const { render, createApp } = createRenderer<Node, Element>({
 *   patchProp,
 *   ...nodeOps
 * })
 * ```
 */
export function createRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>) {
  return baseCreateRenderer<HostNode, HostElement>(options)
}

// Separate API for creating hydration-enabled renderer.
// Hydration logic is only used when calling this function, making it
// tree-shakable.
export function createHydrationRenderer(
  options: RendererOptions<Node, Element>
) {
  return baseCreateRenderer(options, createHydrationFunctions)
}

// overload 1: no hydration
function baseCreateRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement>

// overload 2: with hydration
function baseCreateRenderer(
  options: RendererOptions<Node, Element>,
  createHydrationFns: typeof createHydrationFunctions
): HydrationRenderer

// implementation
function baseCreateRenderer(
  options: RendererOptions,
  createHydrationFns?: typeof createHydrationFunctions
): any {
  // compile-time feature flags check
  if (__ESM_BUNDLER__ && !__TEST__) {
    initFeatureFlags()
  }

  const target = getGlobalThis()
  target.__VUE__ = true
  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    setDevtoolsHook(target.__VUE_DEVTOOLS_GLOBAL_HOOK__, target)
  }

  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
    setScopeId: hostSetScopeId = NOOP,
    cloneNode: hostCloneNode,
    insertStaticContent: hostInsertStaticContent
  } = options

  // 注意: 此闭包内的函数应使用 `const xxx = () => {}`
  // 以防止被压缩工具内联.
  /**
   * 比较新旧 vnode
   * @param n1 oldVnode
   * @param n2 newVnode
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   * @returns
   */
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
    // 如果旧的 vnode 等于新的 vnode，说明没有发生变化，直接返回无需处理
    if (n1 === n2) {
      return
    }

    // 如果 oldVnode 存在，但是新旧 vnode 的 type 和 key 都不一样
    if (n1 && !isSameVNodeType(n1, n2)) {
      // 获取锚点：就是旧节点的下一个节点（主要用于标记 newVnode 添加的位置）
      anchor = getNextHostNode(n1)
      // 卸载旧 vnode，这样就不需要 diff 比较，而是直接当 mount 挂载处理
      unmount(n1, parentComponent, parentSuspense, true)
      n1 = null
    }

    // 如果这里 n1 还存在，那么说明 n1 和 n2 的 type 和 key 肯定是相等的
    // 因为如果其中一个不一样，n1 就是 null
    // 如果新的 vnode.patchFlag 需要退出 diff 优化的，也就是必须全量比较
    if (n2.patchFlag === PatchFlags.BAIL) {
      optimized = false // 退出 diff 优化
      n2.dynamicChildren = null
    }

    const { type, ref, shapeFlag } = n2
    switch (type) {
      case Text: // 文本节点
        processText(n1, n2, container, anchor)
        break
      case Comment: // 注释节点
        processCommentNode(n1, n2, container, anchor)
        break
      case Static: // 静态节点
        if (n1 == null) {
          mountStaticNode(n2, container, anchor, isSVG)
        } else if (__DEV__) {
          patchStaticNode(n1, n2, container, isSVG)
        }
        break
      case Fragment: // 处理 Fragment
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
          // 处理元素节点
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
          // 处理组件节点
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
          // 处理 teleport
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
          // 处理 Suspense
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

    // set ref
    if (ref != null && parentComponent) {
      setRef(ref, n1 && n1.ref, parentSuspense, n2 || n1, !n2)
    }
  }

  /**
   * 处理文本节点
   * @param n1
   * @param n2
   * @param container
   * @param anchor
   */
  const processText: ProcessTextOrCommentFn = (n1, n2, container, anchor) => {
    // 旧的文本不存在
    if (n1 == null) {
      // 创建文本并插入到 anchor 前面
      hostInsert(
        (n2.el = hostCreateText(n2.children as string)),
        container,
        anchor
      )
    } else {
      // 旧的节点存在，更新文本
      const el = (n2.el = n1.el!)
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }

  /**
   * 处理注释
   * @param n1
   * @param n2
   * @param container
   * @param anchor
   */
  const processCommentNode: ProcessTextOrCommentFn = (
    n1,
    n2,
    container,
    anchor
  ) => {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateComment((n2.children as string) || '')),
        container,
        anchor
      )
    } else {
      // 不支持动态评论（所以说就将旧的评论节点赋值给新的即可）
      n2.el = n1.el
    }
  }

  const mountStaticNode = (
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean
  ) => {
    // static nodes are only present when used with compiler-dom/runtime-dom
    // which guarantees presence of hostInsertStaticContent.
    ;[n2.el, n2.anchor] = hostInsertStaticContent!(
      n2.children as string,
      container,
      anchor,
      isSVG,
      n2.el,
      n2.anchor
    )
  }

  /**
   * Dev / HMR only
   */
  const patchStaticNode = (
    n1: VNode,
    n2: VNode,
    container: RendererElement,
    isSVG: boolean
  ) => {
    // static nodes are only patched during dev for HMR
    if (n2.children !== n1.children) {
      const anchor = hostNextSibling(n1.anchor!)
      // remove existing
      removeStaticNode(n1)
      // insert new
      ;[n2.el, n2.anchor] = hostInsertStaticContent!(
        n2.children as string,
        container,
        anchor,
        isSVG
      )
    } else {
      n2.el = n1.el
      n2.anchor = n1.anchor
    }
  }

  const moveStaticNode = (
    { el, anchor }: VNode,
    container: RendererElement,
    nextSibling: RendererNode | null
  ) => {
    let next
    while (el && el !== anchor) {
      next = hostNextSibling(el)
      hostInsert(el, container, nextSibling)
      el = next
    }
    hostInsert(anchor!, container, nextSibling)
  }

  const removeStaticNode = ({ el, anchor }: VNode) => {
    let next
    while (el && el !== anchor) {
      next = hostNextSibling(el)
      hostRemove(el)
      el = next
    }
    hostRemove(anchor!)
  }

  /**
   * 处理元素节点（第一次挂载还是 patch 更新）
   * n1 不存在，mount(n2); n1 存在，patch(n1, n2)
   * @param n1
   * @param n2
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   */
  const processElement = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    isSVG = isSVG || (n2.type as string) === 'svg'
    if (n1 == null) {
      mountElement(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    } else {
      patchElement(
        n1,
        n2,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    }
  }

  /**
   * 挂载元素组件
   * @param vnode
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   */
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
    // 渲染的真实元素
    let el: RendererElement
    let vnodeHook: VNodeHook | undefined | null
    const { type, props, shapeFlag, transition, patchFlag, dirs } = vnode
    if (
      !__DEV__ &&
      vnode.el &&
      hostCloneNode !== undefined &&
      patchFlag === PatchFlags.HOISTED
    ) {
      // 静态提升：如果一个节点是纯静态的（没有任何数据绑定），则编译器会把它提取到渲染器之外。
      // <div><span>static</span></div>
      // 当这个组件重新渲染的时候，会发现 patchFlag 是 HOISTED，就不会 createElement
      // 而是使用克隆，因为克隆一个现成的远比重新创建一个新的要快。
      // 这也是处理静态内容的性能外挂。
      el = vnode.el = hostCloneNode(vnode.el)
    } else {
      // 调用 createElement 方法创建 type 对应的元素
      el = vnode.el = hostCreateElement(
        vnode.type as string,
        isSVG,
        props && props.is,
        props
      )

      // 先挂载子元素，因为某些 props 可能依赖于已经渲染好的子内容
      if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        // 如果子节点是纯文本，则调用 setElementText 给 el 添加文本
        hostSetElementText(el, vnode.children as string)
      } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // 多个子节点，挂载子节点到 el 上
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

      // dirs 代表的是自定义指令（所有的自定义指令都会放在这里）
      if (dirs) {
        // 在 created 的时候触发自定义指令中的钩子函数
        invokeDirectiveHook(vnode, null, parentComponent, 'created')
      }
      // props
      if (props) {
        for (const key in props) {
          if (key !== 'value' && !isReservedProp(key)) {
            // 比较并更新 prop 属性方法
            // 但是这里将旧值设置为 null，这个方法就变成了创建并设置的功能
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
        /**
         * Special case for setting value on DOM elements:
         * - it can be order-sensitive (e.g. should be set *after* min/max, #2325, #4024)
         * - it needs to be forced (#1471)
         * #2353 proposes adding another renderer option to configure this, but
         * the properties affects are so finite it is worth special casing it
         * here to reduce the complexity. (Special casing it also should not
         * affect non-DOM renderers)
         */
        if ('value' in props) {
          hostPatchProp(el, 'value', null, props.value)
        }
        if ((vnodeHook = props.onVnodeBeforeMount)) {
          invokeVNodeHook(vnodeHook, parentComponent, vnode)
        }
      }
      // 样式隔离，这也是 Scoped CSS 的原理，他会给当前 DOM 添加 data-v-xxxx 的属性
      // 就是给 el 添加 id 属性
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
    // 唤醒 beforeMount 生命周期函数
    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
    }
    // #1583 For inside suspense + suspense not resolved case, enter hook should call when suspense resolved
    // #1689 For inside suspense + suspense resolved case, just call it
    const needCallTransitionHooks =
      (!parentSuspense || (parentSuspense && !parentSuspense.pendingBranch)) &&
      transition &&
      !transition.persisted
    if (needCallTransitionHooks) {
      transition!.beforeEnter(el)
    }
    // 将 el 插入到 container 容器中
    hostInsert(el, container, anchor)
    if (
      (vnodeHook = props && props.onVnodeMounted) ||
      needCallTransitionHooks ||
      dirs
    ) {
      // 这里其实执行的是 queuePostFlushCb 方法
      // 作用就是在挂载后执行的一些回调函数，这里传进去一个 fn
      // 挂载完成后执行这个回调函数
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        needCallTransitionHooks && transition!.enter(el)
        dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
      }, parentSuspense)
    }
  }

  const setScopeId = (
    el: RendererElement,
    vnode: VNode,
    scopeId: string | null,
    slotScopeIds: string[] | null,
    parentComponent: ComponentInternalInstance | null
  ) => {
    // 其实就是给 el 添加 id 属性
    if (scopeId) {
      hostSetScopeId(el, scopeId)
    }
    if (slotScopeIds) {
      for (let i = 0; i < slotScopeIds.length; i++) {
        hostSetScopeId(el, slotScopeIds[i])
      }
    }
    if (parentComponent) {
      let subTree = parentComponent.subTree
      if (
        __DEV__ &&
        subTree.patchFlag > 0 &&
        subTree.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
      ) {
        subTree =
          filterSingleRoot(subTree.children as VNodeArrayChildren) || subTree
      }
      if (vnode === subTree) {
        const parentVNode = parentComponent.vnode
        setScopeId(
          el,
          parentVNode,
          parentVNode.scopeId,
          parentVNode.slotScopeIds,
          parentComponent.parent
        )
      }
    }
  }

  /**
   * 挂载子节点到 container 上，对子节点一个一个的 patch，oldVnode 是 null
   * @param children 需要被挂载的子节点
   * @param container 父级容器
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   * @param start
   */
  const mountChildren: MountChildrenFn = (
    children,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    slotScopeIds,
    optimized,
    start = 0
  ) => {
    for (let i = start; i < children.length; i++) {
      const child = (children[i] = optimized
        ? cloneIfMounted(children[i] as VNode)
        : normalizeVNode(children[i]))
      // 因为是挂载子节点，说明之前肯定是没有的，所以 oldValue 是 null
      // 开始重新走 patch
      patch(
        null,
        child,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    }
  }

  /**
   * 比较新旧 DOM（元素节点）
   * @param n1 old vnode
   * @param n2 new vnode
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   */
  const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    // 问：这里为什么要执行 newVNode.el = oldVNode.el ?
    // 因为前面有一个判断 isSameVNodeType(n1, n2)，如果单反 type 或者 key 不相等，n1 都是 null
    // 那时候只会进入 mount 逻辑，而不会进入 patch 逻辑
    // 因此这里的 n1 和 n2 只会存在 props 和 children 的不同
    // 所以这里 n2 的 el 就是 n1 的 el
    const el = (n2.el = n1.el!)
    let { patchFlag, dynamicChildren, dirs } = n2
    // #1426 take the old vnode's patch flag into account since user may clone a
    // compiler-generated vnode, which de-opts to FULL_PROPS
    // 这步操作应该是为了验证 newVNode 中的 patchFlag 是否包含 FULL_PROPS
    patchFlag |= n1.patchFlag & PatchFlags.FULL_PROPS
    // 拿到新旧 vnode 的 prop
    const oldProps = n1.props || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    let vnodeHook: VNodeHook | undefined | null

    // 在 beforeUpdate 钩子中禁用递归
    parentComponent && toggleRecurse(parentComponent, false)
    if ((vnodeHook = newProps.onVnodeBeforeUpdate)) {
      invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
    }
    if (dirs) {
      invokeDirectiveHook(n2, n1, parentComponent, 'beforeUpdate')
    }
    parentComponent && toggleRecurse(parentComponent, true)

    if (__DEV__ && isHmrUpdating) {
      // HMR updated, force full diff
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    const areChildrenSVG = isSVG && n2.type !== 'foreignObject'
    // 如果是动态的子组件，则遍历新的子组件，跟旧的子组件按顺序一一 patch，不需要 diff 整个树
    if (dynamicChildren) {
      patchBlockChildren(
        n1.dynamicChildren!,
        dynamicChildren,
        el,
        parentComponent,
        parentSuspense,
        areChildrenSVG,
        slotScopeIds
      )
      if (__DEV__ && parentComponent && parentComponent.type.__hmrId) {
        traverseStaticChildren(n1, n2)
      }
    } else if (!optimized) {
      // 如果是不需要 diff 优化的
      // 完整的 diff children
      patchChildren(
        n1,
        n2,
        el,
        null,
        parentComponent,
        parentSuspense,
        areChildrenSVG,
        slotScopeIds,
        false
      )
    }

    if (patchFlag > 0) {
      // 存在一个 patchFlag 意味着该元素的渲染代码已经由编译器生成，可以走快速通道。
      // 在这条路径中，旧节点和新节点保证具有相同的形状
      if (patchFlag & PatchFlags.FULL_PROPS) {
        // 元素属性包含动态键，需要进行完整差异比较
        patchProps(
          el,
          n2,
          oldProps,
          newProps,
          parentComponent,
          parentSuspense,
          isSVG
        )
      } else {
        // class
        // 这种情况是，元素节点绑定了动态的 class 样式
        if (patchFlag & PatchFlags.CLASS) {
          // 如果旧节点的 class 不等于新节点的 class，则直接用新的 class 更新 class
          if (oldProps.class !== newProps.class) {
            hostPatchProp(el, 'class', null, newProps.class, isSVG)
          }
        }

        // style
        // 动态绑定了 style，需要清除掉 oldStyle 中的样式，然后新增 newStyle 中的样式
        if (patchFlag & PatchFlags.STYLE) {
          hostPatchProp(el, 'style', oldProps.style, newProps.style, isSVG)
        }

        // props
        // 动态绑定了除 class/style 以外的动态属性，动态属性/特性的键值被保存下来，以便更快地进行迭代
        // 注意，像 :[foo]=“bar” 这样的动态键值对会导致此优化过程退出，并进行完整的差异比较，因为我们需要取消设置旧键值
        if (patchFlag & PatchFlags.PROPS) {
          // if the flag is present then dynamicProps must be non-null
          const propsToUpdate = n2.dynamicProps!
          for (let i = 0; i < propsToUpdate.length; i++) {
            const key = propsToUpdate[i]
            const prev = oldProps[key]
            const next = newProps[key]
            // #1471 force patch value
            if (next !== prev || key === 'value') {
              hostPatchProp(
                el,
                key,
                prev,
                next,
                isSVG,
                n1.children as VNode[],
                parentComponent,
                parentSuspense,
                unmountChildren
              )
            }
          }
        }
      }

      // text
      // 元素只有一个动态的文本子节点.
      if (patchFlag & PatchFlags.TEXT) {
        if (n1.children !== n2.children) {
          hostSetElementText(el, n2.children as string)
        }
      }
    } else if (!optimized && dynamicChildren == null) {
      // 在非优化的情况下，直接全量比较 props
      patchProps(
        el,
        n2,
        oldProps,
        newProps,
        parentComponent,
        parentSuspense,
        isSVG
      )
    }

    // 全部 patch 结束后，调用 update 的生命周期钩子（跟 mounted 一样）
    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
        dirs && invokeDirectiveHook(n2, n1, parentComponent, 'updated')
      }, parentSuspense)
    }
  }

  // The fast path for blocks.
  /**
   * diff 的快速比较
   * 其实就是循环新的子节点，然后找到旧子节点对应索引的节点，执行 patch 方法。
   * @param oldChildren
   * @param newChildren
   * @param fallbackContainer
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   */
  const patchBlockChildren: PatchBlockChildrenFn = (
    oldChildren,
    newChildren,
    fallbackContainer,
    parentComponent,
    parentSuspense,
    isSVG,
    slotScopeIds
  ) => {
    // 遍历新的 children
    for (let i = 0; i < newChildren.length; i++) {
      // 按照新的 children 的顺序，分别拿到第 index 位置的单个子节点
      const oldVNode = oldChildren[i]
      const newVNode = newChildren[i]
      // Determine the container (parent element) for the patch.
      // container 要么是 oldVNode.el.parentNode，要么是 fallbackContainer
      const container =
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        oldVNode.el &&
        // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        (oldVNode.type === Fragment ||
          // - In the case of different nodes, there is going to be a replacement
          // which also requires the correct parent container
          !isSameVNodeType(oldVNode, newVNode) ||
          // - In the case of a component, it could contain anything.
          oldVNode.shapeFlag & (ShapeFlags.COMPONENT | ShapeFlags.TELEPORT))
          ? hostParentNode(oldVNode.el)!
          : // In other cases, the parent container is not actually used so we
            // just pass the block element here to avoid a DOM parentNode call.
            fallbackContainer
      // 调用 patch 比较新旧 DOM
      patch(
        oldVNode,
        newVNode,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        true
      )
    }
  }

  const patchProps = (
    el: RendererElement,
    vnode: VNode,
    oldProps: Data,
    newProps: Data,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean
  ) => {
    if (oldProps !== newProps) {
      for (const key in newProps) {
        // empty string is not valid prop
        if (isReservedProp(key)) continue
        const next = newProps[key]
        const prev = oldProps[key]
        // defer patching value
        if (next !== prev && key !== 'value') {
          hostPatchProp(
            el,
            key,
            prev,
            next,
            isSVG,
            vnode.children as VNode[],
            parentComponent,
            parentSuspense,
            unmountChildren
          )
        }
      }
      if (oldProps !== EMPTY_OBJ) {
        for (const key in oldProps) {
          if (!isReservedProp(key) && !(key in newProps)) {
            hostPatchProp(
              el,
              key,
              oldProps[key],
              null,
              isSVG,
              vnode.children as VNode[],
              parentComponent,
              parentSuspense,
              unmountChildren
            )
          }
        }
      }
      if ('value' in newProps) {
        hostPatchProp(el, 'value', oldProps.value, newProps.value)
      }
    }
  }

  const processFragment = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateText(''))!
    const fragmentEndAnchor = (n2.anchor = n1 ? n1.anchor : hostCreateText(''))!

    let { patchFlag, dynamicChildren, slotScopeIds: fragmentSlotScopeIds } = n2

    if (
      __DEV__ &&
      // #5523 dev root fragment may inherit directives
      (isHmrUpdating || patchFlag & PatchFlags.DEV_ROOT_FRAGMENT)
    ) {
      // HMR updated / Dev root fragment (w/ comments), force full diff
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    // check if this is a slot fragment with :slotted scope ids
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds
        ? slotScopeIds.concat(fragmentSlotScopeIds)
        : fragmentSlotScopeIds
    }

    if (n1 == null) {
      hostInsert(fragmentStartAnchor, container, anchor)
      hostInsert(fragmentEndAnchor, container, anchor)
      // a fragment can only have array children
      // since they are either generated by the compiler, or implicitly created
      // from arrays.
      mountChildren(
        n2.children as VNodeArrayChildren,
        container,
        fragmentEndAnchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    } else {
      if (
        patchFlag > 0 &&
        patchFlag & PatchFlags.STABLE_FRAGMENT &&
        dynamicChildren &&
        // #2715 the previous fragment could've been a BAILed one as a result
        // of renderSlot() with no valid children
        n1.dynamicChildren
      ) {
        // a stable fragment (template root or <template v-for>) doesn't need to
        // patch children order, but it may contain dynamicChildren.
        patchBlockChildren(
          n1.dynamicChildren,
          dynamicChildren,
          container,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds
        )
        if (__DEV__ && parentComponent && parentComponent.type.__hmrId) {
          traverseStaticChildren(n1, n2)
        } else if (
          // #2080 if the stable fragment has a key, it's a <template v-for> that may
          //  get moved around. Make sure all root level vnodes inherit el.
          // #2134 or if it's a component root, it may also get moved around
          // as the component is being moved.
          n2.key != null ||
          (parentComponent && n2 === parentComponent.subTree)
        ) {
          traverseStaticChildren(n1, n2, true /* shallow */)
        }
      } else {
        // keyed / unkeyed, or manual fragments.
        // for keyed & unkeyed, since they are compiler generated from v-for,
        // each child is guaranteed to be a block so the fragment will never
        // have dynamicChildren.
        patchChildren(
          n1,
          n2,
          container,
          fragmentEndAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      }
    }
  }

  /**
   * 处理组件类型
   * @param n1
   * @param n2
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   */
  const processComponent = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    n2.slotScopeIds = slotScopeIds
    // 如果旧的不存在
    if (n1 == null) {
      // 如果是 keep-alive 类型的组件，只需要调用 activate 方法激活就可以了
      // 因为 keep-alive 组件，在 “卸载” 的时候也只是让它失去活性，而非真正意义上的卸载
      if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).activate(
          n2,
          container,
          anchor,
          isSVG,
          optimized
        )
      } else {
        // 创建组件实例 + 挂载组件
        mountComponent(
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    } else {
      // 旧的存在，就调用更新组件方法
      // 当父组件修改了某个属性值，恰好这个属性被子节点通过 prop 的方式使用了
      // 这个时候，就会进入当前更新逻辑
      updateComponent(n1, n2, optimized)
    }
  }

  /**
   * 挂载组件
   * @param initialVNode 需要被挂载的组件的 vnode
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   * @returns
   */
  const mountComponent: MountComponentFn = (
    initialVNode,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    // Vue2 的兼容，不看
    const compatMountInstance =
      __COMPAT__ && initialVNode.isCompatRoot && initialVNode.component

    // 1. 初始化组件实例对象（这个实例对象包含了组件应有的特性，还包含了 vnode）
    // initialVNode.component = instance
    // instance.vnode = initialVNode
    const instance: ComponentInternalInstance =
      compatMountInstance ||
      (initialVNode.component = createComponentInstance(
        initialVNode,
        parentComponent,
        parentSuspense
      ))

    if (__DEV__ && instance.type.__hmrId) {
      registerHMR(instance)
    }

    if (__DEV__) {
      pushWarningContext(initialVNode)
      startMeasure(instance, `mount`)
    }

    // 注入渲染器内部逻辑以实现 keepAlive
    if (isKeepAlive(initialVNode)) {
      ;(instance.ctx as KeepAliveContext).renderer = internals
    }

    // 处理 setup 上下文中的 props 和 slots
    if (!(__COMPAT__ && compatMountInstance)) {
      if (__DEV__) {
        startMeasure(instance, `init`)
      }
      // 2. 开始构建组件 --- 最最重要的一件事儿就是生成组件的 render 函数
      // 要么是 setup 返回了一个方法，作为 render
      // 要么是 compile(template) 返回的 render
      // 要么是 Component 对象中手动编辑的 render
      setupComponent(instance)
      if (__DEV__) {
        endMeasure(instance, `init`)
      }
    }

    // setup（）是异步的。此组件依赖于在继续之前解析异步逻辑
    if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
      parentSuspense && parentSuspense.registerDep(instance, setupRenderEffect)

      // Give it a placeholder if this is not hydration
      // TODO handle self-defined fallback
      if (!initialVNode.el) {
        const placeholder = (instance.subTree = createVNode(Comment))
        processCommentNode(null, placeholder, container!, anchor)
      }
      return
    }

    // 建立组件中状态和 effect 之间的关联
    setupRenderEffect(
      instance,
      initialVNode,
      container,
      anchor,
      parentSuspense,
      isSVG,
      optimized
    )

    if (__DEV__) {
      popWarningContext()
      endMeasure(instance, `mount`)
    }
  }

  /**
   * 更新组件
   * @param n1
   * @param n2
   * @param optimized
   * @returns
   */
  const updateComponent = (n1: VNode, n2: VNode, optimized: boolean) => {
    const instance = (n2.component = n1.component)!
    if (shouldUpdateComponent(n1, n2, optimized)) {
      if (
        __FEATURE_SUSPENSE__ &&
        instance.asyncDep &&
        !instance.asyncResolved
      ) {
        // async & still pending - just update props and slots
        // since the component's reactive effect for render isn't set-up yet
        // async & 仍在等待中的 - 只需更新 props 和 slots，因为组件的渲染 effect 效果尚未设置
        if (__DEV__) {
          pushWarningContext(n2)
        }
        // 渲染组件之前，更新组件的属性
        updateComponentPreRender(instance, n2, optimized)
        if (__DEV__) {
          popWarningContext()
        }
        return
      } else {
        // 正常的组件更新
        instance.next = n2
        // 如果子组件也排队，请将其删除，以避免在同一次刷新中重复更新同一个子组件。
        invalidateJob(instance.update)
        // 执行 update，其实就是执行 effect.fn
        instance.update()
      }
    } else {
      // 不需要更新
      n2.el = n1.el
      instance.vnode = n2
    }
  }

  const setupRenderEffect: SetupRenderEffectFn = (
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    // 组件更新函数
    // 如果组件实例还没有被挂载：那么找到组件的根节点，然后执行 patch 方法挂载，挂载完了执行生命周期函数，标记为组件已经挂载完了
    // 如果组件实例已经被挂在了：从根节点开始 patch

    // 一共有两种情况，会执行组件的 update
    // 1. 当第一次执行挂载的时候，render 函数中对响应式属性的访问，会导致属性和 effect 之间的依赖收集
    //    这时组件内部因为某些操作，导致属性值发生了变化，从而触发 trigger，然后执行 scheduler，调用 componentUpdateFn 更新
    //    这步叫组件自更新。
    // 2. 还是组件挂载完了之后，父组件因为操作更新了某个属性，恰好这个属性被子组件通过 prop 的方式接收了
    //    这时候就会进入 updateComponent，然后发现组件的 props 发生了变化，确实需要更新
    //    然后调用了 instance.update，同样的还是会执行 componentUpdateFn 中的更新逻辑。
    const componentUpdateFn = () => {
      // 如果组件实例还没有被挂载
      // 生成组件的根节点，然后通过 patch 执行挂载
      if (!instance.isMounted) {
        let vnodeHook: VNodeHook | null | undefined
        const { el, props } = initialVNode
        const { bm, m, parent } = instance
        const isAsyncWrapperVNode = isAsyncWrapper(initialVNode)

        toggleRecurse(instance, false)
        // 执行 beforeMount hook
        if (bm) {
          invokeArrayFns(bm)
        }
        // onVnodeBeforeMount
        if (
          !isAsyncWrapperVNode &&
          (vnodeHook = props && props.onVnodeBeforeMount)
        ) {
          invokeVNodeHook(vnodeHook, parent, initialVNode)
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          instance.emit('hook:beforeMount')
        }
        toggleRecurse(instance, true)

        if (el && hydrateNode) {
          // vnode has adopted host node - perform hydration instead of mount.
          const hydrateSubTree = () => {
            if (__DEV__) {
              startMeasure(instance, `render`)
            }
            // 获取组件实例的根
            instance.subTree = renderComponentRoot(instance)
            if (__DEV__) {
              endMeasure(instance, `render`)
            }
            if (__DEV__) {
              startMeasure(instance, `hydrate`)
            }
            hydrateNode!(
              el as Node,
              instance.subTree,
              instance,
              parentSuspense,
              null
            )
            if (__DEV__) {
              endMeasure(instance, `hydrate`)
            }
          }

          if (isAsyncWrapperVNode) {
            ;(initialVNode.type as ComponentOptions).__asyncLoader!().then(
              // note: we are moving the render call into an async callback,
              // which means it won't track dependencies - but it's ok because
              // a server-rendered async wrapper is already in resolved state
              // and it will never need to change.
              () => !instance.isUnmounted && hydrateSubTree()
            )
          } else {
            hydrateSubTree()
          }
        } else {
          if (__DEV__) {
            startMeasure(instance, `render`)
          }
          // 通过 renderComponentRoot 创建组件的根 vnode
          // 其实就是执行组件的 render 函数，然后再通过 normalizeVNode 标准化一下得到的新的 vnode
          // 组件本身的 vnode 代表的是 <ComponentChild />
          // subTree 代表的是组件的根元素 <div> ... </div>
          const subTree = (instance.subTree = renderComponentRoot(instance))
          if (__DEV__) {
            endMeasure(instance, `render`)
          }
          if (__DEV__) {
            startMeasure(instance, `patch`)
          }
          // 调用 patch 方法挂载组件节点
          patch(
            null,
            subTree,
            container,
            anchor,
            instance,
            parentSuspense,
            isSVG
          )
          if (__DEV__) {
            endMeasure(instance, `patch`)
          }
          // 同步 el 属性
          initialVNode.el = subTree.el
        }
        // 执行 mounted hook
        if (m) {
          // 挂载后的 promise
          queuePostRenderEffect(m, parentSuspense)
        }
        // onVnodeMounted
        if (
          !isAsyncWrapperVNode &&
          (vnodeHook = props && props.onVnodeMounted)
        ) {
          const scopedInitialVNode = initialVNode
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook!, parent, scopedInitialVNode),
            parentSuspense
          )
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          queuePostRenderEffect(
            () => instance.emit('hook:mounted'),
            parentSuspense
          )
        }

        // activated hook for keep-alive roots.
        // #1742 activated hook must be accessed after first render
        // since the hook may be injected by a child keep-alive
        if (
          initialVNode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE ||
          (parent &&
            isAsyncWrapper(parent.vnode) &&
            parent.vnode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE)
        ) {
          instance.a && queuePostRenderEffect(instance.a, parentSuspense)
          if (
            __COMPAT__ &&
            isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
          ) {
            queuePostRenderEffect(
              () => instance.emit('hook:activated'),
              parentSuspense
            )
          }
        }
        // 标记组件已经挂在完毕
        instance.isMounted = true

        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsComponentAdded(instance)
        }

        // #2458: deference mount-only object parameters to prevent memleaks
        initialVNode = container = anchor = null as any
      } else {
        // 更新组件
        // This is triggered by mutation of component's own state (next: null)
        // OR parent calling processComponent (next: VNode)
        let { next, bu, u, parent, vnode } = instance
        let originNext = next
        let vnodeHook: VNodeHook | null | undefined
        if (__DEV__) {
          pushWarningContext(next || instance.vnode)
        }

        // Disallow component effect recursion during pre-lifecycle hooks.
        toggleRecurse(instance, false)
        if (next) {
          next.el = vnode.el
          // 渲染前更新组件
          updateComponentPreRender(instance, next, optimized)
        } else {
          next = vnode
        }

        // beforeUpdate hook
        if (bu) {
          invokeArrayFns(bu)
        }
        // onVnodeBeforeUpdate
        if ((vnodeHook = next.props && next.props.onVnodeBeforeUpdate)) {
          invokeVNodeHook(vnodeHook, parent, next, vnode)
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          instance.emit('hook:beforeUpdate')
        }
        toggleRecurse(instance, true)

        // render
        if (__DEV__) {
          startMeasure(instance, `render`)
        }
        // 获取更新后的 subTree（组件中根元素的 vnode）
        const nextTree = renderComponentRoot(instance)
        if (__DEV__) {
          endMeasure(instance, `render`)
        }
        // 旧的组件根 vnode
        const prevTree = instance.subTree
        instance.subTree = nextTree

        if (__DEV__) {
          startMeasure(instance, `patch`)
        }
        // 执行 patch 方法，更新两个 vnode
        patch(
          prevTree,
          nextTree,
          // parent may have changed if it's in a teleport
          hostParentNode(prevTree.el!)!,
          // anchor may have changed if it's in a fragment
          getNextHostNode(prevTree),
          instance,
          parentSuspense,
          isSVG
        )
        if (__DEV__) {
          endMeasure(instance, `patch`)
        }
        next.el = nextTree.el
        if (originNext === null) {
          // self-triggered update. In case of HOC, update parent component
          // vnode el. HOC is indicated by parent instance's subTree pointing
          // to child component's vnode
          updateHOCHostEl(instance, nextTree.el)
        }
        // updated hook
        if (u) {
          queuePostRenderEffect(u, parentSuspense)
        }
        // onVnodeUpdated
        if ((vnodeHook = next.props && next.props.onVnodeUpdated)) {
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook!, parent, next!, vnode),
            parentSuspense
          )
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          queuePostRenderEffect(
            () => instance.emit('hook:updated'),
            parentSuspense
          )
        }

        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsComponentUpdated(instance)
        }

        if (__DEV__) {
          popWarningContext()
        }
      }
    }

    // create reactive effect for rendering
    // 给组件的 render 函数创建一个 effect（当组件更新的时候，会执行 update 方法）
    const effect = (instance.effect = new ReactiveEffect(
      componentUpdateFn,
      () => queueJob(update), // 类似于 watch，将 update 方法推入一个执行队列，并包装成 promise
      instance.scope // track it in component's effect scope
    ))

    // 创建一个 update 方法
    // 执行方法之后会执行 effect.run，相当于执行 componentUpdateFn，并设置 activeEffect
    const update: SchedulerJob = (instance.update = () => effect.run())
    update.id = instance.uid
    // allowRecurse
    // #1801, #2043 component render effects should allow recursive updates
    toggleRecurse(instance, true)

    if (__DEV__) {
      effect.onTrack = instance.rtc
        ? e => invokeArrayFns(instance.rtc!, e)
        : void 0
      effect.onTrigger = instance.rtg
        ? e => invokeArrayFns(instance.rtg!, e)
        : void 0
      update.ownerInstance = instance
    }

    // 执行 update 方法，建立 render 跟 effect 之间的关联
    update()
  }

  /**
   * 在渲染前更新组件
   * @param instance
   * @param nextVNode
   * @param optimized
   */
  const updateComponentPreRender = (
    instance: ComponentInternalInstance,
    nextVNode: VNode,
    optimized: boolean
  ) => {
    nextVNode.component = instance
    const prevProps = instance.vnode.props
    instance.vnode = nextVNode
    instance.next = null
    updateProps(instance, nextVNode.props, prevProps, optimized)
    updateSlots(instance, nextVNode.children, optimized)

    pauseTracking()
    // props update may have triggered pre-flush watchers.
    // flush them before the render update.
    flushPreFlushCbs(undefined, instance.update)
    resetTracking()
  }

  /**
   * 非优化版本的 diff children
   * @param n1
   * @param n2
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   * @returns
   */
  const patchChildren: PatchChildrenFn = (
    n1,
    n2,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    slotScopeIds,
    optimized = false
  ) => {
    // oldVNodeChildren
    const c1 = n1 && n1.children
    // oldVNodeShapeFlag
    const prevShapeFlag = n1 ? n1.shapeFlag : 0
    // newVNodeChildren
    const c2 = n2.children

    const { patchFlag, shapeFlag } = n2
    // 这里是 diff 的开挂模式（编译的时候就标记了，这里可以快速比较）
    if (patchFlag > 0) {
      // 表示 newVNode 是一个子级包含或部分包含 key 的节点
      if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
        // 这可以是完全键控的，也可以是混合的（有些键控，有些不键控）。
        // patchFlag 的存在意味着子节点保证是 “数组”
        patchKeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        return
      } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
        // 没有 key 的（这个就需要全量比较了）
        patchUnkeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        return
      }
    }

    // 子节点有三种可能性: text, array 或者没有 children.
    // 如果新的 vnode 是文本类型的子节点
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      // 旧的 vnode 子节点是数组，则直接卸载旧的子节点
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(c1 as VNode[], parentComponent, parentSuspense)
      }
      // 不是数组，只可能是文本，或者没有，只要是不一样，就像 newVNode 的文本设置到 el 上
      if (c2 !== c1) {
        hostSetElementText(container, c2 as string)
      }
    } else {
      // 新的不是文本（数组或者不存在）
      // 旧的是数组子节点
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // 新的也是数组（旧的也是数组）
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // two arrays, cannot assume anything, do full diff
          // 两个都是数组，不能假设任何事情，做全量的 diff（因为这里不是开挂模式，所以也不知道有没有 key 等）
          patchKeyedChildren(
            c1 as VNode[],
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        } else {
          // 新的既不是文本，又不是数组，那只能是没有 children，所以卸载掉旧的 children
          unmountChildren(c1 as VNode[], parentComponent, parentSuspense, true)
        }
      } else {
        // 旧的 children 是 text 或 null
        // 新的 children 是 array 或 null
        if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
          // 如果旧的是文本，则清空文本
          hostSetElementText(container, '')
        }
        // 这个时候旧的只可能是 null 了，新的如果是 null 就不需要处理
        // 所以只需要处理新的是数组的情况。然后开始挂载 children
        // 这里也是循环 children 然后分别 patch
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        }
      }
    }
  }

  /**
   * patch 不包含 key 的 children
   * 取到新旧 children.length 的最小值 minLength
   * 然后从 0 开始，到 minLength 结束，逐一 patch
   * 旧的有剩余，那么就 unmount 剩余的旧的
   * 新的有剩余，那么就 mount 剩余的新的
   * @param c1
   * @param c2
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   */
  const patchUnkeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    c1 = c1 || EMPTY_ARR
    c2 = c2 || EMPTY_ARR
    const oldLength = c1.length
    const newLength = c2.length
    // 最小的子节点长度（从头开始，能 patch 的最大长度）
    const commonLength = Math.min(oldLength, newLength)
    let i
    // 从 0 开始到最大长度，每一个 都执行一次 patch（这也是为什么没有 key 性能差的原因）
    for (i = 0; i < commonLength; i++) {
      const nextChild = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      patch(
        c1[i],
        nextChild,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    }
    // 如果旧的子节点多于新的子节点数量
    if (oldLength > newLength) {
      // 直接卸载掉整个旧的子节点（是从 commonLength 开始卸载）
      // 这里就相当于从 commonLength 开始，对剩余的每一个 child 执行 unmount
      unmountChildren(
        c1,
        parentComponent,
        parentSuspense,
        true,
        false,
        commonLength
      )
    } else {
      // 从 commonLength 开始，对剩余的每一个 child 执行 unmount
      mountChildren(
        c2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized,
        commonLength
      )
    }
  }

  /**
   * children 可能全部都包含 key 或者部分包含 key
   * @param c1 旧的子节点
   * @param c2 新的子节点
   * @param container
   * @param parentAnchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param slotScopeIds
   * @param optimized
   */
  const patchKeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    parentAnchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    let i = 0
    const l2 = c2.length // 新的子节点 length
    let e1 = c1.length - 1 // 旧的 children 结束 index
    let e2 = l2 - 1 // 新的 children 结束 index

    // 1. sync from start 同步从前面开始
    // (a b) c
    // (a b) d e
    while (i <= e1 && i <= e2) {
      // 第一个旧的节点
      const n1 = c1[i]
      // 第一个新的节点
      const n2 = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      // 如果两个节点的 key 和 type 都一样，就深度 patch
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      } else {
        // 如果不一样，就跳出当前循环，比如比较到 c d，发现不一样
        // 从前面开始比较就结束了
        break
      }
      // 正向比较的索引向后移
      i++
    }

    // 2. 同步从后面比较
    // a (b c)
    // d e (b c)
    while (i <= e1 && i <= e2) {
      // 最后一个旧的子节点
      const n1 = c1[e1]
      // 最后一个新的子节点
      const n2 = (c2[e2] = optimized
        ? cloneIfMounted(c2[e2] as VNode)
        : normalizeVNode(c2[e2]))

      // 如果两个节点 key 一致，type 也一致，就深度 patch（可能是完全一样，也可能是 props 或者 children 不一样）
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      } else {
        break
      }
      // 新旧 children 的 index 都向前移动
      e1--
      e2--
    }

    // 到这一步，我认为存在以下几种情况
    // - oldChildren 比较完了
    // - newChildren 比较完了
    // - 新旧都有剩余，但是首位的和最末尾的都不一样

    // 3. i > e1，很明显符合 oldChildren 已经 patch 结束了，剩下的都是 newChildren，只需要挂载即可
    // (a b)
    // (a b) c
    // i = 2, e1 = 1, e2 = 2
    // (a b)
    // c (a b)
    // i = 0, e1 = -1, e2 = 0
    if (i > e1) {
      // 如果还存在 newChildren
      if (i <= e2) {
        // 有可能剩余的 new child 是中间位的，所以要找后面的兄弟节点
        const nextPos = e2 + 1
        // 如果后面存在兄弟节点，就用兄弟节点作为锚点，否则就用父节点作为锚点
        const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
        // 将剩余的 new child 分别挂载
        while (i <= e2) {
          patch(
            null,
            (c2[i] = optimized
              ? cloneIfMounted(c2[i] as VNode)
              : normalizeVNode(c2[i])),
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
          i++
        }
      }
    }

    // 4. i > e2，很明显符合 newChildren 已经 patch 结束了，剩余的都是 oldChildren，只需要 unmount
    // (a b) c
    // (a b)
    // i = 2, e1 = 2, e2 = 1
    // a (b c)
    // (b c)
    // i = 0, e1 = 0, e2 = -1
    else if (i > e2) {
      // 卸载剩余的 child
      while (i <= e1) {
        unmount(c1[i], parentComponent, parentSuspense, true)
        i++
      }
    }

    // 5. 都有剩余，但是新旧都不一样
    // [i ... e1 + 1]: a b [c d e] f g
    // [i ... e2 + 1]: a b [e d c h] f g
    // i = 2, e1 = 4, e2 = 5
    else {
      const s1 = i // 旧的开始索引
      const s2 = i // 新的开始索引

      // 5.1 给 newChildren 构建一个 key => index 的映射关系
      /**
       * 存在 key 的 newChild 在整个 newChildren 中的 index（key => index)
       */
      const keyToNewIndexMap: Map<string | number | symbol, number> = new Map()
      // s2 表示 new 的 start，e2 表示 new 的 end
      for (i = s2; i <= e2; i++) {
        // 当前的 newChild
        const nextChild = (c2[i] = optimized
          ? cloneIfMounted(c2[i] as VNode)
          : normalizeVNode(c2[i]))
        // 如果有 key，则添加 key => i 映射关系（这里并没有修改 restNewChildren）
        // 不过这里并没有存储没有 key 的子节点
        if (nextChild.key != null) {
          if (__DEV__ && keyToNewIndexMap.has(nextChild.key)) {
            warn(
              `Duplicate keys found during update:`,
              JSON.stringify(nextChild.key),
              `Make sure keys are unique.`
            )
          }
          keyToNewIndexMap.set(nextChild.key, i)
        }
      }

      // 5.2 循环遍历需要 patch 的旧子节点，并尝试 patch 匹配的节点以及删除不再存在的节点
      let j
      let patched = 0 // 已经对比完的旧节点数量
      const toBePatched = e2 - s2 + 1 // 剩余的 newChildren 的 length
      // 用于记录是否需要移动
      // 如果不需要移动，说明相对位置顺序是正确的，后面只需要 patch 就好了
      // 如果需要移动，说明位置是错误的
      let moved = false
      // 用于跟踪是否有任何节点已移动
      let maxNewIndexSoFar = 0
      // 作为一个 Map<newIndex, oldIndex> 使用
      // 请注意，oldIndex 偏移了 +1
      // oldIndex = 0 是一个特殊值，表示新节点具有没有对应的旧节点。
      // 用于确定最长稳定子序列
      const newIndexToOldIndexMap = new Array(toBePatched)
      // 根据剩余的 newChildren 的 length，创建一个数组，并且数组的每一项都是 0
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0

      // 然后开始遍历 restOldChildren
      for (i = s1; i <= e1; i++) {
        // 第一个剩余的子节点
        const prevChild = c1[i]
        // 如果说已经 patch 完的旧子节点数量已经大于等于需要对比的新节点数量了
        // 并且还有旧子节点存在，那么只需要卸载就好了
        if (patched >= toBePatched) {
          // all new children have been patched so this can only be a removal
          unmount(prevChild, parentComponent, parentSuspense, true)
          continue
        }
        // 跟 oldChild 相同 key 的 newChild 的 index
        let newIndex
        // 如果当前循环中旧的节点存在 key，那么就从 keyToNewIndexMap 中读取 key 属性
        // 得到的结果要么是 undefined，要么是相同 key 的 newChild 在 newChildren 中的 index
        if (prevChild.key != null) {
          newIndex = keyToNewIndexMap.get(prevChild.key)
        } else {
          // 没有 key 的节点, 尝试定位相同 type 的 no-key 的节点
          // 从 restNewChildren 中查找跟 当前 oldChild 相同 type 的节点，并且这个新节点没有被别的旧节点匹配过
          for (j = s2; j <= e2; j++) {
            if (
              newIndexToOldIndexMap[j - s2] === 0 &&
              isSameVNodeType(prevChild, c2[j] as VNode)
            ) {
              // 找到了，标记一下对应的新节点的位置
              newIndex = j
              break
            }
          }
        }
        // 如果在剩余的新子节点中没找到，直接卸载当前子节点
        if (newIndex === undefined) {
          unmount(prevChild, parentComponent, parentSuspense, true)
        } else {
          // 找到了，在 newIndexToOldIndexMap 中对应的节点标记一下
          // 标记的位置 newIndex - s2 表示新节点在剩余节点中的位置
          // 这个位置中的值代表的是 旧节点的索引 + 1（只要不是 0，就代表被匹配过了）
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          // 下面这个记录位置和标记 move 应该是 patch 完了需要移动到正确的位置（暂时还不知道怎么玩的）
          if (newIndex >= maxNewIndexSoFar) {
            // 如果当前跟 oldChild 相等的 newChild 大于等于 maxNewIndexSoFar（默认 0，第一次肯定是成立的）
            // 用这个字段记录当前找到的新节点的索引
            // 等到下一个循环，oldChild 对应的 newChild 在上一个 newIndex 后面
            // 说明这时候顺序是对的，再记录新的 newIndex
            maxNewIndexSoFar = newIndex
          } else {
            // 如果当前循环 oldChild 对应的 newChild 的 index 小于上一个对应的
            // 说明这个 oldChild 本应该再上一个节点的后面，但是在 newChildren 中跑到了前面
            // 那就标记一下发生了移动。
            moved = true
          }
          // 比较这两个节点
          patch(
            prevChild,
            c2[newIndex] as VNode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
          patched++
        }
      }

      // 5.3 move and mount
      // 最长递增子序列（这里返回的是剩余的新的子结点中不需要移动的索引集合）
      const increasingNewIndexSequence = moved
        ? getSequence(newIndexToOldIndexMap)
        : EMPTY_ARR
      // 最长递增子序列的最后一个索引，j => index
      j = increasingNewIndexSequence.length - 1
      // 倒序遍历（因为 insertBefore 需要一个参照物）
      // 只有从后往前处理，才能保证每次处理一个节点时，右边的是已经排好的
      // 按照剩余的新的子节点来循环
      for (i = toBePatched - 1; i >= 0; i--) {
        // 新的索引
        const nextIndex = s2 + i
        // 新的子节点
        const nextChild = c2[nextIndex] as VNode
        // 锚点（如果是最后一个子节点，锚点就是父节点锚点，否则的话就是后面的兄弟元素）
        const anchor =
          nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor
        // 等于 0，说明 newChild 对应的值是 0，也就是在旧的里面没找到相似的
        if (newIndexToOldIndexMap[i] === 0) {
          // 挂载新的（直接挂载到锚点前面）
          patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        } else if (moved) {
          // move if:
          // There is no stable subsequence (e.g. a reverse)
          // OR current node is not among the stable sequence
          // 如果存在需要移动的节点，并且不在递增子序列，移动
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor, MoveType.REORDER)
          } else {
            j-- // 跳过，这个节点不需要动
          }
        }
      }
    }
  }

  const move: MoveFn = (
    vnode,
    container,
    anchor,
    moveType,
    parentSuspense = null
  ) => {
    const { el, type, transition, children, shapeFlag } = vnode
    if (shapeFlag & ShapeFlags.COMPONENT) {
      move(vnode.component!.subTree, container, anchor, moveType)
      return
    }

    if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
      vnode.suspense!.move(container, anchor, moveType)
      return
    }

    if (shapeFlag & ShapeFlags.TELEPORT) {
      ;(type as typeof TeleportImpl).move(vnode, container, anchor, internals)
      return
    }

    if (type === Fragment) {
      hostInsert(el!, container, anchor)
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move((children as VNode[])[i], container, anchor, moveType)
      }
      hostInsert(vnode.anchor!, container, anchor)
      return
    }

    if (type === Static) {
      moveStaticNode(vnode, container, anchor)
      return
    }

    // single nodes
    const needTransition =
      moveType !== MoveType.REORDER &&
      shapeFlag & ShapeFlags.ELEMENT &&
      transition
    if (needTransition) {
      if (moveType === MoveType.ENTER) {
        transition!.beforeEnter(el!)
        hostInsert(el!, container, anchor)
        queuePostRenderEffect(() => transition!.enter(el!), parentSuspense)
      } else {
        const { leave, delayLeave, afterLeave } = transition!
        const remove = () => hostInsert(el!, container, anchor)
        const performLeave = () => {
          leave(el!, () => {
            remove()
            afterLeave && afterLeave()
          })
        }
        if (delayLeave) {
          delayLeave(el!, remove, performLeave)
        } else {
          performLeave()
        }
      }
    } else {
      hostInsert(el!, container, anchor)
    }
  }

  /**
   * 卸载 vnode 操作
   * @param vnode 被卸载的 vnode
   * @param parentComponent
   * @param parentSuspense
   * @param doRemove
   * @param optimized
   * @returns
   */
  const unmount: UnmountFn = (
    vnode,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false
  ) => {
    const {
      type,
      props,
      ref,
      children,
      dynamicChildren,
      shapeFlag,
      patchFlag,
      dirs
    } = vnode
    // 取消设置 ref，简单说就是将 ref 设置为 null
    if (ref != null) {
      setRef(ref, null, parentSuspense, vnode, true)
    }

    // 如果 vnode 包含 keep-alive 属性，则让这个组件失活，注意这里的 return，只是失活，并不会继续走下面的逻辑销毁 vnode
    if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
      ;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
      return
    }

    const shouldInvokeDirs = shapeFlag & ShapeFlags.ELEMENT && dirs
    const shouldInvokeVnodeHook = !isAsyncWrapper(vnode)

    let vnodeHook: VNodeHook | undefined | null
    if (
      shouldInvokeVnodeHook &&
      (vnodeHook = props && props.onVnodeBeforeUnmount)
    ) {
      invokeVNodeHook(vnodeHook, parentComponent, vnode)
    }

    // 如果是组件，调用 unmountComponent，
    if (shapeFlag & ShapeFlags.COMPONENT) {
      unmountComponent(vnode.component!, parentSuspense, doRemove)
    } else {
      if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
        vnode.suspense!.unmount(parentSuspense, doRemove)
        return
      }

      if (shouldInvokeDirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeUnmount')
      }

      if (shapeFlag & ShapeFlags.TELEPORT) {
        ;(vnode.type as typeof TeleportImpl).remove(
          vnode,
          parentComponent,
          parentSuspense,
          optimized,
          internals,
          doRemove
        )
      } else if (
        dynamicChildren &&
        // #1153: fast path should not be taken for non-stable (v-for) fragments
        (type !== Fragment ||
          (patchFlag > 0 && patchFlag & PatchFlags.STABLE_FRAGMENT))
      ) {
        // fast path for block nodes: only need to unmount dynamic children.
        unmountChildren(
          dynamicChildren,
          parentComponent,
          parentSuspense,
          false,
          true
        )
      } else if (
        (type === Fragment &&
          patchFlag &
            (PatchFlags.KEYED_FRAGMENT | PatchFlags.UNKEYED_FRAGMENT)) ||
        (!optimized && shapeFlag & ShapeFlags.ARRAY_CHILDREN)
      ) {
        unmountChildren(children as VNode[], parentComponent, parentSuspense)
      }

      if (doRemove) {
        remove(vnode)
      }
    }

    if (
      (shouldInvokeVnodeHook &&
        (vnodeHook = props && props.onVnodeUnmounted)) ||
      shouldInvokeDirs
    ) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        shouldInvokeDirs &&
          invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
      }, parentSuspense)
    }
  }

  const remove: RemoveFn = vnode => {
    const { type, el, anchor, transition } = vnode
    if (type === Fragment) {
      if (
        __DEV__ &&
        vnode.patchFlag > 0 &&
        vnode.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT &&
        transition &&
        !transition.persisted
      ) {
        ;(vnode.children as VNode[]).forEach(child => {
          if (child.type === Comment) {
            hostRemove(child.el!)
          } else {
            remove(child)
          }
        })
      } else {
        removeFragment(el!, anchor!)
      }
      return
    }

    if (type === Static) {
      removeStaticNode(vnode)
      return
    }

    const performRemove = () => {
      hostRemove(el!)
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave()
      }
    }

    if (
      vnode.shapeFlag & ShapeFlags.ELEMENT &&
      transition &&
      !transition.persisted
    ) {
      const { leave, delayLeave } = transition
      const performLeave = () => leave(el!, performRemove)
      if (delayLeave) {
        delayLeave(vnode.el!, performRemove, performLeave)
      } else {
        performLeave()
      }
    } else {
      performRemove()
    }
  }

  const removeFragment = (cur: RendererNode, end: RendererNode) => {
    // For fragments, directly remove all contained DOM nodes.
    // (fragment child nodes cannot have transition)
    let next
    while (cur !== end) {
      next = hostNextSibling(cur)!
      hostRemove(cur)
      cur = next
    }
    hostRemove(end)
  }

  const unmountComponent = (
    instance: ComponentInternalInstance,
    parentSuspense: SuspenseBoundary | null,
    doRemove?: boolean
  ) => {
    if (__DEV__ && instance.type.__hmrId) {
      unregisterHMR(instance)
    }

    const { bum, scope, update, subTree, um } = instance

    // beforeUnmount hook
    if (bum) {
      invokeArrayFns(bum)
    }

    if (
      __COMPAT__ &&
      isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
    ) {
      instance.emit('hook:beforeDestroy')
    }

    // stop effects in component scope
    scope.stop()

    // update may be null if a component is unmounted before its async
    // setup has resolved.
    if (update) {
      // so that scheduler will no longer invoke it
      update.active = false
      unmount(subTree, instance, parentSuspense, doRemove)
    }
    // unmounted hook
    if (um) {
      queuePostRenderEffect(um, parentSuspense)
    }
    if (
      __COMPAT__ &&
      isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
    ) {
      queuePostRenderEffect(
        () => instance.emit('hook:destroyed'),
        parentSuspense
      )
    }
    queuePostRenderEffect(() => {
      instance.isUnmounted = true
    }, parentSuspense)

    // A component with async dep inside a pending suspense is unmounted before
    // its async dep resolves. This should remove the dep from the suspense, and
    // cause the suspense to resolve immediately if that was the last dep.
    if (
      __FEATURE_SUSPENSE__ &&
      parentSuspense &&
      parentSuspense.pendingBranch &&
      !parentSuspense.isUnmounted &&
      instance.asyncDep &&
      !instance.asyncResolved &&
      instance.suspenseId === parentSuspense.pendingId
    ) {
      parentSuspense.deps--
      if (parentSuspense.deps === 0) {
        parentSuspense.resolve()
      }
    }

    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      devtoolsComponentRemoved(instance)
    }
  }

  const unmountChildren: UnmountChildrenFn = (
    children,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false,
    start = 0
  ) => {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], parentComponent, parentSuspense, doRemove, optimized)
    }
  }

  /**
   * 获取 vnode 的相邻节点（主要是调用原生方法 nextSibling）
   * @param vnode
   * @returns
   */
  const getNextHostNode: NextFn = vnode => {
    if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      return getNextHostNode(vnode.component!.subTree)
    }
    if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return vnode.suspense!.next()
    }
    return hostNextSibling((vnode.anchor || vnode.el)!)
  }

  /**
   * 渲染函数（渲染 vnode 到页面中）
   * @param vnode 要渲染的 vnode
   * @param container vnode 需要挂载到的容器
   * @param isSVG 不考虑
   */
  const render: RootRenderFunction = (vnode, container, isSVG) => {
    // 如果新的 vnode 为空，但是旧的 vnode 存在，说明需要卸载掉旧的 vnode
    if (vnode == null) {
      if (container._vnode) {
        unmount(container._vnode, null, null, true)
      }
    } else {
      // 否则，将新的 vnode 渲染到页面中
      patch(container._vnode || null, vnode, container, null, null, null, isSVG)
    }
    // 执行挂载后需要执行的 job
    flushPostFlushCbs()
    // 渲染完成以后，将新的 vnode 添加到 container 上当作旧的 vnode
    container._vnode = vnode
  }

  const internals: RendererInternals = {
    p: patch,
    um: unmount,
    m: move,
    r: remove,
    mt: mountComponent,
    mc: mountChildren,
    pc: patchChildren,
    pbc: patchBlockChildren,
    n: getNextHostNode,
    o: options
  }

  let hydrate: ReturnType<typeof createHydrationFunctions>[0] | undefined
  let hydrateNode: ReturnType<typeof createHydrationFunctions>[1] | undefined
  if (createHydrationFns) {
    ;[hydrate, hydrateNode] = createHydrationFns(
      internals as RendererInternals<Node, Element>
    )
  }

  return {
    render,
    hydrate,
    createApp: createAppAPI(render, hydrate)
  }
}

function toggleRecurse(
  { effect, update }: ComponentInternalInstance,
  allowed: boolean
) {
  effect.allowRecurse = update.allowRecurse = allowed
}

/**
 * #1156
 * When a component is HMR-enabled, we need to make sure that all static nodes
 * inside a block also inherit the DOM element from the previous tree so that
 * HMR updates (which are full updates) can retrieve the element for patching.
 *
 * #2080
 * Inside keyed `template` fragment static children, if a fragment is moved,
 * the children will always be moved. Therefore, in order to ensure correct move
 * position, el should be inherited from previous nodes.
 */
export function traverseStaticChildren(n1: VNode, n2: VNode, shallow = false) {
  const ch1 = n1.children
  const ch2 = n2.children
  if (isArray(ch1) && isArray(ch2)) {
    for (let i = 0; i < ch1.length; i++) {
      // this is only called in the optimized path so array children are
      // guaranteed to be vnodes
      const c1 = ch1[i] as VNode
      let c2 = ch2[i] as VNode
      if (c2.shapeFlag & ShapeFlags.ELEMENT && !c2.dynamicChildren) {
        if (c2.patchFlag <= 0 || c2.patchFlag === PatchFlags.HYDRATE_EVENTS) {
          c2 = ch2[i] = cloneIfMounted(ch2[i] as VNode)
          c2.el = c1.el
        }
        if (!shallow) traverseStaticChildren(c1, c2)
      }
      // also inherit for comment nodes, but not placeholders (e.g. v-if which
      // would have received .el during block patch)
      if (__DEV__ && c2.type === Comment && !c2.el) {
        c2.el = c1.el
      }
    }
  }
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        p[i] = j
        result.push(i)
        continue
      }
      u = 0
      v = result.length - 1
      while (u < v) {
        c = (u + v) >> 1
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
