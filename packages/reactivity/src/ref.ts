import {
  activeEffect,
  shouldTrack,
  trackEffects,
  triggerEffects
} from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { isArray, hasChanged, IfAny } from '@vue/shared'
import { isProxy, toRaw, isReactive, toReactive } from './reactive'
import type { ShallowReactiveMarker } from './reactive'
import { CollectionTypes } from './collectionHandlers'
import { createDep, Dep } from './dep'

declare const RefSymbol: unique symbol
export declare const RawSymbol: unique symbol

export interface Ref<T = any> {
  value: T
  /**
   * Type differentiator only.
   * We need this to be in public d.ts but don't want it to show up in IDE
   * autocomplete, so we use a private Symbol instead.
   */
  [RefSymbol]: true
}

type RefBase<T> = {
  dep?: Dep
  value: T
}

/**
 * 收集 ref 依赖，接收的参数是被收集的 Ref 实例
 * @param ref
 */
export function trackRefValue(ref: RefBase<any>) {
  // 如果应该收集（参考操作数组的逻辑），或者有副作用函数在使用 ref 对象
  if (shouldTrack && activeEffect) {
    // 其实这里主要的目的就是为了解构 reactive 类型的数据，比如说 reactive(ref(0))
    // 只是为了能拿到最终的 Ref 类型的数据
    ref = toRaw(ref)
    if (__DEV__) {
      trackEffects(ref.dep || (ref.dep = createDep()), {
        target: ref,
        type: TrackOpTypes.GET,
        key: 'value'
      })
    } else {
      // 获取或者初始化一个 dep 集合，并赋值给 ref 实例对象
      // 然后开始追踪依赖
      // 正向是 ref.dep 收集 effect；反向是 effect 收集 ref.dep
      trackEffects(ref.dep || (ref.dep = createDep()))
    }
  }
}

/**
 * 触发 Ref 类型的依赖
 * @param ref
 * @param newVal
 */
export function triggerRefValue(ref: RefBase<any>, newVal?: any) {
  ref = toRaw(ref)
  if (ref.dep) {
    if (__DEV__) {
      triggerEffects(ref.dep, {
        target: ref,
        type: TriggerOpTypes.SET,
        key: 'value',
        newValue: newVal
      })
    } else {
      // 触发依赖
      triggerEffects(ref.dep)
    }
  }
}

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
export function isRef(r: any): r is Ref {
  // 有 __v_isRef 属性并且值为 true 就代表是 Ref 类型的数据
  return !!(r && r.__v_isRef === true)
}

export function ref<T extends object>(
  value: T
): [T] extends [Ref] ? T : Ref<UnwrapRef<T>>
export function ref<T>(value: T): Ref<UnwrapRef<T>>
export function ref<T = any>(): Ref<T | undefined>
export function ref(value?: unknown) {
  // 调用 ref 方法等于直接调用 createRef 方法
  return createRef(value, false)
}

declare const ShallowRefMarker: unique symbol

export type ShallowRef<T = any> = Ref<T> & { [ShallowRefMarker]?: true }

export function shallowRef<T extends object>(
  value: T
): T extends Ref ? T : ShallowRef<T>
export function shallowRef<T>(value: T): ShallowRef<T>
export function shallowRef<T = any>(): ShallowRef<T | undefined>
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

/**
 * 创建 ref 对象
 * @param rawValue ref 接收的值
 * @param shallow 是否是浅层 ref
 * @returns
 */
function createRef(rawValue: unknown, shallow: boolean) {
  // 如果传进来的本身就是个 ref 类型的数据，那么直接返回
  if (isRef(rawValue)) {
    return rawValue
  }
  // 返回 RefImpl 实例对象
  return new RefImpl(rawValue, shallow)
}

class RefImpl<T> {
  private _value: T
  private _rawValue: T

  /**
   * 当前 ref 实例所收集的所有
   */
  public dep?: Dep = undefined
  /**
   * 用于标记这是一个 Ref 对象
   */
  public readonly __v_isRef = true

  constructor(value: T, public readonly __v_isShallow: boolean) {
    // 保存原始对象
    this._rawValue = __v_isShallow ? value : toRaw(value)
    // 拿到响应式对象或者原始值
    this._value = __v_isShallow ? value : toReactive(value)
  }

  /**
   * 通过实例对象的 value 属性访问属性值（这也就是为什么要通过 ref.value 访问结果了）
   */
  get value() {
    // 访问属性值时，直接收集 ref 依赖
    // 这里是直接收集整个 ref 的依赖，如果 ref 的 value 是个对象，那么访问对象的属性还是通过 proxy 的 getter 收集
    trackRefValue(this)
    return this._value
  }

  /**
   * 通过 ref.value 修改新的属性值
   */
  set value(newVal) {
    // 拿到新的值的原始值
    newVal = this.__v_isShallow ? newVal : toRaw(newVal)
    // 判断数据是否发生了改变
    if (hasChanged(newVal, this._rawValue)) {
      // 如果改变了，就修改数据
      this._rawValue = newVal
      this._value = this.__v_isShallow ? newVal : toReactive(newVal)
      // 触发 Ref 依赖
      triggerRefValue(this, newVal)
    }
  }
}

export function triggerRef(ref: Ref) {
  triggerRefValue(ref, __DEV__ ? ref.value : void 0)
}

export function unref<T>(ref: T | Ref<T>): T {
  return isRef(ref) ? (ref.value as any) : ref
}

/**
 * 浅解包处理器
 * get: 如果属性值是 ref，则返回 ref.value；否则直接返回
 * set: 如果是 ref，则修改 ref.value；否则调用 Reflect.set()
 */
const shallowUnwrapHandlers: ProxyHandler<any> = {
  get: (target, key, receiver) => unref(Reflect.get(target, key, receiver)),
  set: (target, key, value, receiver) => {
    const oldValue = target[key]
    if (isRef(oldValue) && !isRef(value)) {
      oldValue.value = value
      return true
    } else {
      return Reflect.set(target, key, value, receiver)
    }
  }
}

export function proxyRefs<T extends object>(
  objectWithRefs: T
): ShallowUnwrapRef<T> {
  return isReactive(objectWithRefs)
    ? objectWithRefs
    : new Proxy(objectWithRefs, shallowUnwrapHandlers)
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T
  set: (value: T) => void
}

class CustomRefImpl<T> {
  public dep?: Dep = undefined

  private readonly _get: ReturnType<CustomRefFactory<T>>['get']
  private readonly _set: ReturnType<CustomRefFactory<T>>['set']

  public readonly __v_isRef = true

  constructor(factory: CustomRefFactory<T>) {
    const { get, set } = factory(
      () => trackRefValue(this),
      () => triggerRefValue(this)
    )
    this._get = get
    this._set = set
  }

  get value() {
    return this._get()
  }

  set value(newVal) {
    this._set(newVal)
  }
}

export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  return new CustomRefImpl(factory) as any
}

export type ToRefs<T = any> = {
  [K in keyof T]: ToRef<T[K]>
}
export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (__DEV__ && !isProxy(object)) {
    console.warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = isArray(object) ? new Array(object.length) : {}
  for (const key in object) {
    ret[key] = toRef(object, key)
  }
  return ret
}

class ObjectRefImpl<T extends object, K extends keyof T> {
  public readonly __v_isRef = true

  constructor(
    private readonly _object: T,
    private readonly _key: K,
    private readonly _defaultValue?: T[K]
  ) {}

  get value() {
    const val = this._object[this._key]
    return val === undefined ? (this._defaultValue as T[K]) : val
  }

  set value(newVal) {
    this._object[this._key] = newVal
  }
}

export type ToRef<T> = IfAny<T, Ref<T>, [T] extends [Ref] ? T : Ref<T>>

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): ToRef<T[K]>

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K,
  defaultValue: T[K]
): ToRef<Exclude<T[K], undefined>>

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K,
  defaultValue?: T[K]
): ToRef<T[K]> {
  const val = object[key]
  return isRef(val)
    ? val
    : (new ObjectRefImpl(object, key, defaultValue) as any)
}

// corner case when use narrows type
// Ex. type RelativePath = string & { __brand: unknown }
// RelativePath extends object -> true
type BaseTypes = string | number | boolean

/**
 * This is a special exported interface for other packages to declare
 * additional types that should bail out for ref unwrapping. For example
 * \@vue/runtime-dom can declare it like so in its d.ts:
 *
 * ``` ts
 * declare module '@vue/reactivity' {
 *   export interface RefUnwrapBailTypes {
 *     runtimeDOMBailTypes: Node | Window
 *   }
 * }
 * ```
 *
 * Note that api-extractor somehow refuses to include `declare module`
 * augmentations in its generated d.ts, so we have to manually append them
 * to the final generated d.ts in our build process.
 */
export interface RefUnwrapBailTypes {}

export type ShallowUnwrapRef<T> = {
  [K in keyof T]: T[K] extends Ref<infer V>
    ? V
    : // if `V` is `unknown` that means it does not extend `Ref` and is undefined
    T[K] extends Ref<infer V> | undefined
    ? unknown extends V
      ? undefined
      : V | undefined
    : T[K]
}

export type UnwrapRef<T> = T extends ShallowRef<infer V>
  ? V
  : T extends Ref<infer V>
  ? UnwrapRefSimple<V>
  : UnwrapRefSimple<T>

export type UnwrapRefSimple<T> = T extends
  | Function
  | CollectionTypes
  | BaseTypes
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  | { [RawSymbol]?: true }
  ? T
  : T extends Array<any>
  ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
  : T extends object & { [ShallowReactiveMarker]?: never }
  ? {
      [P in keyof T]: P extends symbol ? T[P] : UnwrapRef<T[P]>
    }
  : T
