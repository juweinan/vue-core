import { isObject, toRawType, def } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers
} from './collectionHandlers'
import type { UnwrapRefSimple, Ref, RawSymbol } from './ref'

export const enum ReactiveFlags {
  // 如果一个对象被标记了 __v_skip，那么这个对象就永远不会被转换成响应式代理对象了
  SKIP = '__v_skip',
  // 用于标识一个对象是否是通过 reactive 或者 shallowReactive 创建的响应式对象
  IS_REACTIVE = '__v_isReactive',
  // 用于标识一个对象是否是通过 readonly 或者 shallowReadonly 创建的只读对象
  IS_READONLY = '__v_isReadonly',
  // 用于标识一个对象是否是通过 shallowReactive 或者 shallowReadonly 创建的浅层代理对象
  IS_SHALLOW = '__v_isShallow',
  // 指向的是被代理的原始对象，如果一个对象被代理过了，那么访问 proxy.__v_raw 就一定能拿到原始对象
  RAW = '__v_raw'
}

export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.IS_SHALLOW]?: boolean
  [ReactiveFlags.RAW]?: any
}

export const reactiveMap = new WeakMap<Target, any>()
export const shallowReactiveMap = new WeakMap<Target, any>()
export const readonlyMap = new WeakMap<Target, any>()
export const shallowReadonlyMap = new WeakMap<Target, any>()

const enum TargetType {
  INVALID = 0,
  COMMON = 1,
  COLLECTION = 2
}

function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

/**
 * 获取目标对象的类型
 * 如果目标对象是被标记 __v_skip 或者不是可扩展（不可以在上面添加新的属性）的对象
 * 那么就返回 INVALID
 * 否则根据目标对象的原始类型，返回 COMMON 或者 COLLECTION
 */
function getTargetType(value: Target) {
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}

// only unwrap nested ref
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRefSimple<T>

/**
 * 为原始对象创建一个响应式的副本
 *
 * 响应式转换是 “深度的”，他会影响所有的嵌套属性。在基于 ES2015 Proxy 的实现中，返回的 proxy 对象跟原始对象是不相等的。
 * 因此建议使用返回的 proxy 对象，避免依赖原始对象
 *
 * 响应式对象还会自动解包其中包含的引用（refs），因此在访问和修改时，不需要使用 .value
 *
 * ```js
 * const count = ref(0)
 * const obj = reactive({
 *   count
 * })
 *
 * obj.count++
 * obj.count // -> 1
 * count.value // -> 1
 * ```
 */
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // 如果尝试去观察一个只读的 proxy，返回只读版本（这也说明，reactive 不会处理 readonly 代理对象）
  if (isReadonly(target)) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}

export declare const ShallowReactiveMarker: unique symbol

export type ShallowReactive<T> = T & { [ShallowReactiveMarker]?: true }

/**
 * Return a shallowly-reactive copy of the original object, where only the root
 * level properties are reactive. It also does not auto-unwrap refs (even at the
 * root level).
 */
export function shallowReactive<T extends object>(
  target: T
): ShallowReactive<T> {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends ReadonlyMap<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends WeakMap<infer K, infer V>
  ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends Set<infer U>
  ? ReadonlySet<DeepReadonly<U>>
  : T extends ReadonlySet<infer U>
  ? ReadonlySet<DeepReadonly<U>>
  : T extends WeakSet<infer U>
  ? WeakSet<DeepReadonly<U>>
  : T extends Promise<infer U>
  ? Promise<DeepReadonly<U>>
  : T extends Ref<infer U>
  ? Readonly<Ref<DeepReadonly<U>>>
  : T extends {}
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : Readonly<T>

/**
 * Creates a readonly copy of the original object. Note the returned copy is not
 * made reactive, but `readonly` can be called on an already reactive object.
 */
export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap
  )
}

/**
 * Returns a reactive-copy of the original object, where only the root level
 * properties are readonly, and does NOT unwrap refs nor recursively convert
 * returned properties.
 * This is used for creating the props proxy object for stateful components.
 */
export function shallowReadonly<T extends object>(target: T): Readonly<T> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap
  )
}

/**
 * 创建响应式对象的核心函数
 * @param target 被代理对象
 * @param isReadonly 是否只读（reactive 的时候，肯定是 false）
 * @param baseHandlers target 是普通对象或者数组的时候，使用 baseHandlers 作为 proxy 的 handler
 * @param collectionHandlers target 是 map、set、weakmap 或者 weakset 的时候，使用 collectionHandlers 作为 proxy 的 handler  
 * @param proxyMap 用于缓存被代理对象和代理对象的映射关系，防止一个原始对象多次调用 reactive 或者 readonly 生成多个代理对象
 * @returns 返回生成的代理对象
 */
function createReactiveObject(
  target: Target, 
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // 只有对象才可以被代理，如果不是对象，直接返回原始值
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // 被代理对象已经是一个代理对象了，返回它（通过 ReactiveFlags.RAW 判断是否被代理过了）
  // 特例：如果一个对象是普通代理对象（reactive 创建的），但是现在要变成 readonly，就不能直接返回了
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // 被代理对象已经有了相应的代理对象，直接返回曾经生成的代理对象。目的是，防止一个 raw 多次调用 reactive
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  // 只有特定的 value 类型能够被观察到（被标记 __v_skip 或者不可扩展的，都直接返回被代理对象）
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }
  // 创建一个 proxy 代理对象，将被代理对象和代理对象缓存起来，并返回代理对象
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  proxyMap.set(target, proxy)
  return proxy
}

export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

export function isShallow(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}

// 如果参数是一个响应式的对象，那么就递归获取原始对象，直到获取到一个不是响应式对象的原始对象为止
export function toRaw<T>(observed: T): T {
  // 其实这里的 raw 就是参数的原始对象
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}

export function markRaw<T extends object>(
  value: T
): T & { [RawSymbol]?: true } {
  def(value, ReactiveFlags.SKIP, true)
  return value
}

/**
 * 如果 value 是对象，将 value 转为 reactive 对象，否则就使用 value
 * @param value 
 * @returns 
 */
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

export const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value as Record<any, any>) : value
