import {
  VNode,
  VNodeProps,
  createVNode,
  VNodeArrayChildren,
  Fragment,
  Text,
  Comment,
  isVNode
} from './vnode'
import { Teleport, TeleportProps } from './components/Teleport'
import { Suspense, SuspenseProps } from './components/Suspense'
import { isObject, isArray } from '@vue/shared'
import { RawSlots } from './componentSlots'
import {
  FunctionalComponent,
  Component,
  ComponentOptions,
  ConcreteComponent
} from './component'
import { EmitsOptions } from './componentEmits'
import { DefineComponent } from './apiDefineComponent'

// `h` is a more user-friendly version of `createVNode` that allows omitting the
// props when possible. It is intended for manually written render functions.
// Compiler-generated code uses `createVNode` because
// 1. it is monomorphic and avoids the extra call overhead
// 2. it allows specifying patchFlags for optimization

/*
// type only
h('div')

// type + props
h('div', {})

// type + omit props + children
// Omit props does NOT support named slots
h('div', []) // array
h('div', 'foo') // text
h('div', h('br')) // vnode
h(Component, () => {}) // default slot

// type + props + children
h('div', {}, []) // array
h('div', {}, 'foo') // text
h('div', {}, h('br')) // vnode
h(Component, {}, () => {}) // default slot
h(Component, {}, {}) // named slots

// named slots without props requires explicit `null` to avoid ambiguity
h(Component, null, {})
**/

type RawProps = VNodeProps & {
  // used to differ from a single VNode object as children
  __v_isVNode?: never
  // used to differ from Array children
  [Symbol.iterator]?: never
} & Record<string, any>

type RawChildren =
  | string
  | number
  | boolean
  | VNode
  | VNodeArrayChildren
  | (() => any)

// fake constructor type returned from `defineComponent`
interface Constructor<P = any> {
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never
  new (...args: any[]): { $props: P }
}

// The following is a series of overloads for providing props validation of
// manually written render functions.

// 这里又是对 h 函数的函数重载
// element 元素标签
export function h(type: string, children?: RawChildren): VNode
export function h(
  type: string,
  props?: RawProps | null,
  children?: RawChildren | RawSlots
): VNode

// text/comment 文本或者注释
export function h(
  type: typeof Text | typeof Comment,
  children?: string | number | boolean
): VNode
export function h(
  type: typeof Text | typeof Comment,
  props?: null,
  children?: string | number | boolean
): VNode
// fragment 文档片段
export function h(type: typeof Fragment, children?: VNodeArrayChildren): VNode
export function h(
  type: typeof Fragment,
  props?: RawProps | null,
  children?: VNodeArrayChildren
): VNode

// teleport (target prop is required) teleport 内置组件，用于将元素添加到指定节点上
export function h(
  type: typeof Teleport,
  props: RawProps & TeleportProps,
  children: RawChildren
): VNode

// suspense 异步渲染组件
export function h(type: typeof Suspense, children?: RawChildren): VNode
export function h(
  type: typeof Suspense,
  props?: (RawProps & SuspenseProps) | null,
  children?: RawChildren | RawSlots
): VNode

// functional component 函数式组件
export function h<P, E extends EmitsOptions = {}>(
  type: FunctionalComponent<P, E>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// catch-all for generic component types
export function h(type: Component, children?: RawChildren): VNode

// concrete component
export function h<P>(
  type: ConcreteComponent | string,
  children?: RawChildren
): VNode
export function h<P>(
  type: ConcreteComponent<P> | string,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren
): VNode

// component without props
export function h(
  type: Component,
  props: null,
  children?: RawChildren | RawSlots
): VNode

// exclude `defineComponent` constructors
export function h<P>(
  type: ComponentOptions<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// fake constructor type returned by `defineComponent` or class component
export function h(type: Constructor, children?: RawChildren): VNode
export function h<P>(
  type: Constructor<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// fake constructor type returned by `defineComponent`
export function h(type: DefineComponent, children?: RawChildren): VNode
export function h<P>(
  type: DefineComponent<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

/**
 * h 函数：参数增强器！主要判断并处理传递进来的参数
 * 处理成 type, props，children 这种标准的参数
 * 然后调用 createVNode 方法
 * @param type vnode 类型
 * @param propsOrChildren vnode 的属性配置对象或者子节点对象
 * @param children 子节点
 * @returns 
 */
export function h(type: any, propsOrChildren?: any, children?: any): VNode {
  // h 函数接收到的参数个数
  const l = arguments.length
  // 如果只有两个参数（参数二要么是 vnode 类型的子节点，要么是属性配置对象，要么就是其他类型的子节点）
  if (l === 2) {
    // 如果参数二是对象，但是不是数组
    if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
      // 参数二是个 vnode，说明 type 标签没有任何属性，只有一个子节点
      if (isVNode(propsOrChildren)) {
        // 创建 vnode
        return createVNode(type, null, [propsOrChildren])
      }
      // 如果不是 vnode，说明是 props，则创建 type 的 vnode，并添加 props
      return createVNode(type, propsOrChildren)
    } else {
      // 这种情况是，存在第二个参数，但不是对象，说明是个纯文本或者数组，那么就直接创建 type 以及他的子节点的 vnode
      return createVNode(type, null, propsOrChildren)
    }
  } else {
    // 如果参数个数大于 3 个，则第三个以及后面的，都是 children，并且处理成数组格式
    // 相当于，当前 type 节点，有多个子节点
    if (l > 3) {
      children = Array.prototype.slice.call(arguments, 2)
      // 参数等于 3 个，并且 children 还是一个 vnode，处理成数组格式
    } else if (l === 3 && isVNode(children)) {
      children = [children]
    }
    // 调用 createVNode 创建 vnode
    return createVNode(type, propsOrChildren, children)
  }
}
