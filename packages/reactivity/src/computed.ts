import { DebuggerOptions, ReactiveEffect } from './effect'
import { Ref, trackRefValue, triggerRefValue } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'
import { Dep } from './dep'

declare const ComputedRefSymbol: unique symbol

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
  [ComputedRefSymbol]: true
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (...args: any[]) => T
export type ComputedSetter<T> = (v: T) => void

/**
 * 可写入的计算属性选项
 * 带有 getter 和 setter 的计算属性选项
 */
export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

export class ComputedRefImpl<T> {
  /**
   * 计算属性收集的依赖（跟 RefImpl 相似）
   */
  public dep?: Dep = undefined

  private _value!: T
  /**
   * 将计算属性中的 getter 作为 effect.fn 实例化了
   */
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  public _dirty = true
  public _cacheable: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean,
    isSSR: boolean
  ) {
    // 将 getter 作为副作用函数，创建 _effect 实例，并存储在 ComputedRefImpl 实例对象上
    // 参数二是一个 scheduler，用于处理什么时候开始执行触发依赖的逻辑
    this.effect = new ReactiveEffect(getter, () => {
      if (!this._dirty) {
        this._dirty = true
        triggerRefValue(this)
      }
    })
    this.effect.computed = this
    this.effect.active = this._cacheable = !isSSR
    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    const self = toRaw(this)
    // 访问计算属性时，开始收集依赖，不过这里收集的并不是构造函数中创建的 effect，因为那里并没有执行 run，所以 activeEffect 也不是 this.effect
    trackRefValue(self)
    // 第一次是 _dirty = true，所以可以进入
    if (self._dirty || !self._cacheable) {
      // 修改 _dirty 为 false
      self._dirty = false
      // 获取 getter 的结果，这里的返回值其实就是 computed 中 get 方法的返回值
      // 同时这个操作修改了 activeEffect 为 this.effect
      self._value = self.effect.run()!
    }
    // 返回结果
    return self._value
  }

  set value(newValue: T) {
    // 这里就是执行 set 方法，至于 set 方法中做了什么，那又是一段全新且独立的 track 和 trigger 了
    this._setter(newValue)
  }
}

export function computed<T>(
  getter: ComputedGetter<T>,
  debugOptions?: DebuggerOptions
): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions,
  isSSR = false
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  const onlyGetter = isFunction(getterOrOptions)
  // 如果接受的参数是一个方法，那么就把它当作是一个 getter
  // 并且创建一个默认的 setter，只不过这里的 setter 是个没有任何意义的空方法
  if (onlyGetter) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    // 如果参数一不是一个方法，则 get 作为 getter，set 作为 setter 使用
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 创建一个 ComputedRefImpl 实例
  const cRef = new ComputedRefImpl(getter, setter, onlyGetter || !setter, isSSR)

  // 开发环境逻辑，无需理会
  if (__DEV__ && debugOptions && !isSSR) {
    cRef.effect.onTrack = debugOptions.onTrack
    cRef.effect.onTrigger = debugOptions.onTrigger
  }

  // 返回计算属性实例
  return cRef as any
}
