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

  /**
   * 被缓存起来的计算属性
   */
  private _value!: T
  /**
   * 存在 fn 属性，对应的是 computed 方法传入的 get
   * 存在 scheduler 属性，对应的是构造函数中定义的方法，作用就是标记数据已经脏了，并且触发依赖（监听了计算属性的所有副作用函数）
   * 存在 computed 属性
   */
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  /**
   * 数据是否脏了，脏了的话就需要重新计算而不是取 _value
   */
  public _dirty = true
  public _cacheable: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean,
    isSSR: boolean
  ) {
    // 将 computed 中传入的 get 方法作为 fn，传入 scheduler 方法
    this.effect = new ReactiveEffect(getter, () => {
      // scheduler 实现中，如果数据不是脏的，那么就让数据标记为脏的，然后触发依赖
      // 触发的依赖是监听了当前计算属性的所有副作用函数
      // 这样执行对应的 effect.fn 就会进入计算属性的 getter 了
      if (!this._dirty) {
        this._dirty = true
        // 这里触发的依赖是监听了计算属性的 effect，然后执行 fn 有进入到了 get value
        // 然后 _dirty 已经设置为 false 了，开始计算新的值
        // 但是计算新的值，是当触发的 effect.fn 里面访问了计算属性，才开始计算的，而不是执行了 scheduler 就已经计算了
        triggerRefValue(this)
      }
    })
    // 把当前 effect 标记为 computed
    this.effect.computed = this
    this.effect.active = this._cacheable = !isSSR
    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    const self = toRaw(this)
    // 访问 cRef.value，开始收集依赖。如果是副作用函数访问了 cRef.value，那么 activeEffect 就是这个副作用函数
    // 这里是 cRef.dep 和监听了 cRef.value 的 effect 之间相互收集
    trackRefValue(self)
    // 第一次或者执行过了 scheduler 后是 _dirty = true，所以可以进入
    if (self._dirty || !self._cacheable) {
      // 修改 _dirty 为 false
      self._dirty = false
      // 执行 cRef.effect.run()，这时的 activeEffect 就是 cRef.effect，fn 就是 computed 传入的 get 方法
      // 在 get 方法中有访问了什么值，那就是那些值和 cRef.effect 之间相互收集依赖了
      // 这里收集起来的 effect 可是带有 computed 和 scheduler 属性的
      // 得到结果，缓存起来，并返回
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
