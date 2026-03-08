import {
  isRef,
  isShallow,
  Ref,
  ComputedRef,
  ReactiveEffect,
  isReactive,
  ReactiveFlags,
  EffectScheduler,
  DebuggerOptions
} from '@vue/reactivity'
import { SchedulerJob, queuePreFlushCb } from './scheduler'
import {
  EMPTY_OBJ,
  isObject,
  isArray,
  isFunction,
  isString,
  hasChanged,
  NOOP,
  remove,
  isMap,
  isSet,
  isPlainObject
} from '@vue/shared'
import {
  currentInstance,
  ComponentInternalInstance,
  isInSSRComponentSetup,
  setCurrentInstance,
  unsetCurrentInstance
} from './component'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { queuePostRenderEffect } from './renderer'
import { warn } from './warning'
import { DeprecationTypes } from './compat/compatConfig'
import { checkCompatEnabled, isCompatEnabled } from './compat/compatConfig'
import { ObjectWatchOptionItem } from './componentOptions'

export type WatchEffect = (onCleanup: OnCleanup) => void

export type WatchSource<T = any> = Ref<T> | ComputedRef<T> | (() => T)

export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onCleanup: OnCleanup
) => any

type MapSources<T, Immediate> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
    ? Immediate extends true
      ? V | undefined
      : V
    : T[K] extends object
    ? Immediate extends true
      ? T[K] | undefined
      : T[K]
    : never
}

type OnCleanup = (cleanupFn: () => void) => void

export interface WatchOptionsBase extends DebuggerOptions {
  flush?: 'pre' | 'post' | 'sync'
}

export interface WatchOptions<Immediate = boolean> extends WatchOptionsBase {
  immediate?: Immediate
  deep?: boolean
}

export type WatchStopHandle = () => void

// Simple effect.
export function watchEffect(
  effect: WatchEffect,
  options?: WatchOptionsBase
): WatchStopHandle {
  return doWatch(effect, null, options)
}

export function watchPostEffect(
  effect: WatchEffect,
  options?: DebuggerOptions
) {
  return doWatch(
    effect,
    null,
    (__DEV__
      ? { ...options, flush: 'post' }
      : { flush: 'post' }) as WatchOptionsBase
  )
}

export function watchSyncEffect(
  effect: WatchEffect,
  options?: DebuggerOptions
) {
  return doWatch(
    effect,
    null,
    (__DEV__
      ? { ...options, flush: 'sync' }
      : { flush: 'sync' }) as WatchOptionsBase
  )
}

// initial value for watchers to trigger on undefined initial values
const INITIAL_WATCHER_VALUE = {}

type MultiWatchSources = (WatchSource<unknown> | object)[]

// watch 的函数重载
// overload: array of multiple sources + cb
export function watch<
  T extends MultiWatchSources,
  Immediate extends Readonly<boolean> = false
>(
  sources: [...T],
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: multiple sources w/ `as const`
// watch([foo, bar] as const, () => {})
// somehow [...T] breaks when the type is readonly
export function watch<
  T extends Readonly<MultiWatchSources>,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: single source + cb
export function watch<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: watching reactive object w/ cb
export function watch<
  T extends object,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

/**
 * watch 方法的具体实现
 * @param source 被监听的数据源
 * @param cb 监听的回调函数
 * @param options watch 的配置参数
 * @returns 
 */
export function watch<T = any, Immediate extends Readonly<boolean> = false>(
  source: T | WatchSource<T>,
  cb: any,
  options?: WatchOptions<Immediate>
): WatchStopHandle {
  // 开发环境代码，无需理会
  if (__DEV__ && !isFunction(cb)) {
    warn(
      `\`watch(fn, options?)\` signature has been moved to a separate API. ` +
        `Use \`watchEffect(fn, options?)\` instead. \`watch\` now only ` +
        `supports \`watch(source, cb, options?) signature.`
    )
  }
  // 执行 doWatch 方法，将接收到的参数全部传进去
  return doWatch(source as any, cb, options)
}

/**
 * watch 方法的具体实现
 * @param source 
 * @param cb 
 * @param param2 
 * @returns 
 */
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb: WatchCallback | null,
  { immediate, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ
): WatchStopHandle {
  // 开发环境，无需理会
  if (__DEV__ && !cb) {
    if (immediate !== undefined) {
      warn(
        `watch() "immediate" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
    if (deep !== undefined) {
      warn(
        `watch() "deep" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
  }

  // 创建一个 watch 中的警告提示方法（无需理会）
  const warnInvalidSource = (s: unknown) => {
    warn(
      `Invalid watch source: `,
      s,
      `A watch source can only be a getter/effect function, a ref, ` +
        `a reactive object, or an array of these types.`
    )
  }

  // 代表当前实例（组件实例，页面实例，反正就是使用了 watch 的 .vue 文件）
  const instance = currentInstance
  // 初始化一个 getter，用于存储处理后的 source
  let getter: () => any
  let forceTrigger = false
  let isMultiSource = false

  // 根据 source 的类型，也就是 watch 中的第一个参数，处理 getter 方法（兼容数据）
  // 如果 source 是 Ref 类型，那么 getter = () => source.value
  // 如果 source 是 Reactive 类型，那么 getter = () => source，并且默认开启 deep 模式
  // 如果 source 是 Array 类型，那么 getter = () => sourceMapArray
  // 如果 source 是 Function 类型
  //    - cb 存在，那么 getter = () => source()，这里的 source 返回的是一个同步结果
  //    - cb 不存在，那么 source 就是一个 effect.fn，getter => source() 这里的 source 返回的是一个 promise
  // 如果 source 不是上面提到的这些类型，则 getter 就是一个空的方法
  if (isRef(source)) {
    getter = () => source.value
    forceTrigger = isShallow(source)
  } else if (isReactive(source)) {
    getter = () => source
    deep = true // 如果被监听的是 reactive，则默认开始 deep 模式
  } else if (isArray(source)) {
    // 标记是多个 source
    isMultiSource = true
    forceTrigger = source.some(s => isReactive(s) || isShallow(s))
    getter = () =>
      source.map(s => {
        // 如果 source[i] 是 Ref，返回 ref.value
        if (isRef(s)) {
          return s.value
        } else if (isReactive(s)) {
          // 如果 source[i] 是 Reactive，就找到原始的数据（防止存在多层嵌套的问题）
          return traverse(s)
        } else if (isFunction(s)) {
          // 如果 source[i] 是 Function，执行这个方法，并拿到返回值（因为内部会捕获，所以不会导致程序卡死
          return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
        } else {
          __DEV__ && warnInvalidSource(s)
        }
      })
  } else if (isFunction(source)) {
    // 如果 source 自身就是一个函数
    if (cb) {
      // 并且除了 source 以外，还传递了 cb 函数，那么 getter 的返回值就是 source 执行的返回值
      getter = () =>
        callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
    } else {
      // 如果没有 cb，那么这个 watch 就当成是一个单纯的 effect 函数
      getter = () => {
        // 如果当前实例存在，但是实例对象还没有被挂在，也就是生命周期还没到 mounted
        // 那么就直接返回 undefined
        if (instance && instance.isUnmounted) {
          return
        }
        // 盲猜是被组件实例被卸载了？
        if (cleanup) {
          cleanup()
        }
        // 返回 source 的异步执行结果
        // 这里和上面不同的是，上面的 getter 只是为了拿到同步的处理结果
        // 这里拿到异步处理结果，是因为 source 直接被当成了 effect 的 fn 使用
        return callWithAsyncErrorHandling(
          source,
          instance,
          ErrorCodes.WATCH_CALLBACK,
          [onCleanup]
        )
      }
    }
  } else {
    // 如果
    getter = NOOP
    __DEV__ && warnInvalidSource(source)
  }

  // 数组变异监听兼容性（存在 cb，但是不是 deep 深度监听）（compat 模式，暂时不管）
  if (__COMPAT__ && cb && !deep) {
    // 缓存 getter，这里的 getter 其实就是处理后的 source（也就是 watch 函数中的第一个参数）
    const baseGetter = getter
    // 对 getter 方法进行扩展
    getter = () => {
      // 执行重写前的 getter，得到返回值
      const val = baseGetter()
      // 区分 V2 和 V3 的，而且要开启 compat 模式，暂时不管
      if (
        isArray(val) &&
        checkCompatEnabled(DeprecationTypes.WATCH_ARRAY, instance)
      ) {
        traverse(val)
      }
      return val
    }
  }

  // 深度监听，并且存在 cb，再处理一次 source
  if (cb && deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter())
  }

  let cleanup: () => void

  // 创建一个可以手动清除 watch 的方法
  let onCleanup: OnCleanup = (fn: () => void) => {
    // 其实就是 effect 中的 stop 方法
    cleanup = effect.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  // in SSR there is no need to setup an actual effect, and it should be noop
  // unless it's eager
  if (__SSR__ && isInSSRComponentSetup) {
    // we will also not call the invalidate callback (+ runner is not set up)
    onCleanup = NOOP
    if (!cb) {
      getter()
    } else if (immediate) {
      callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
        getter(),
        isMultiSource ? [] : undefined,
        onCleanup
      ])
    }
    return NOOP
  }

  // 旧的值，如果是监听多个，则是一个空数组，否则是一个空对象
  // 这个 oldValue 可以用于 cb 中的参数
  let oldValue = isMultiSource ? [] : INITIAL_WATCHER_VALUE
  // 创建一个调度器 job 方法
  // 这个调度器方法用于 ReactiveEffect 中的第二个参数 scheduler，但是下面还可能被处理一下
  // 也是在 trigger 的时候，执行 scheduler
  // 其实这里就是异步执行 watch 中的 cb，或者同步执行 watch 中的 source
  const job: SchedulerJob = () => {
    // 如果 effect 已经不是激活状态（被手动停止，或者所在的实例对象被销毁了），什么也不处理
    if (!effect.active) {
      return
    }
    // 如果 watch 中传递了 cb
    if (cb) {
      // watch(source, cb)
      // 重置 activeEffect，然后执行 effect.fn 也就是执行上面处理好的 getter
      // 拿到被监听数据的新的返回值
      const newValue = effect.run()
      // 1. 如果是深度监听
      // 2. 新的结果和旧的结果确定发生了变化
      if (
        deep ||
        forceTrigger ||
        (isMultiSource // 不管是多个还是单个 source，都要判断新的结果和旧的是否发生了变化
          ? (newValue as any[]).some((v, i) =>
              hasChanged(v, (oldValue as any[])[i])
            )
          : hasChanged(newValue, oldValue)) ||
        (__COMPAT__ &&
          isArray(newValue) &&
          isCompatEnabled(DeprecationTypes.WATCH_ARRAY, instance))
      ) {
        // cleanup before running cb again
        if (cleanup) {
          cleanup()
        }
        // 异步执行 cb 回调函数，这也就是 cb 中，能接收到的 newValue，oldValue，还有一个可以手动停止监听的 onCleanup 方法
        callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
          newValue,
          // pass undefined as the old value when it's changed for the first time
          oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
          onCleanup
        ])
        oldValue = newValue
      }
    } else {
      // watchEffect
      // 这里的 effect 就是下面实例化的 effect，执行的 run 方法中的 fn 也就是被处理过的 source（也就是 getter）
      effect.run()
    }
  }

  // important: mark the job as a watcher callback so that scheduler knows
  // it is allowed to self-trigger (#1727)
  // 重重点：将 job 标记为 watcher 的回调函数，以便调度程序知道它可以自触发
  job.allowRecurse = !!cb

  let scheduler: EffectScheduler
  if (flush === 'sync') { // watchSyncEffect
    scheduler = job as any // the scheduler function gets called directly
  } else if (flush === 'post') { // watchPostEffect
    scheduler = () => queuePostRenderEffect(job, instance && instance.suspense)
  } else {
    // default: 'pre'
    // 默认情况下，scheduler 调度器会被包装成微任务，在执行的时候会放到微任务队列
    // 从而达到异步调用的目的
    scheduler = () => queuePreFlushCb(job)
  }

  // 创建 effect 实例
  const effect = new ReactiveEffect(getter, scheduler)

  if (__DEV__) {
    effect.onTrack = onTrack
    effect.onTrigger = onTrigger
  }

  // 初始化时的运行
  if (cb) {
    // 如果存在 cb 参数。配置了立即执行，则直接执行 job，也就是 cb（被包装成了异步）；否则就根据 source 先拿到 oldValue
    if (immediate) {
      job()
    } else {
      oldValue = effect.run()
    }
  } else if (flush === 'post') {
    // 调用 watchPostEffect 的时候
    queuePostRenderEffect(
      effect.run.bind(effect),
      instance && instance.suspense
    )
  } else {
    // 否则的话，就直接执行 source（这里就当作 effect(() => { ... }) 的情况
    effect.run()
  }

  // 返回一个方法，当业务代码中执行 watch 的返回值时，代表着这个 watch 被停止了
  return () => {
    effect.stop()
    if (instance && instance.scope) {
      remove(instance.scope.effects!, effect)
    }
  }
}

// this.$watch
export function instanceWatch(
  this: ComponentInternalInstance,
  source: string | Function,
  value: WatchCallback | ObjectWatchOptionItem,
  options?: WatchOptions
): WatchStopHandle {
  const publicThis = this.proxy as any
  const getter = isString(source)
    ? source.includes('.')
      ? createPathGetter(publicThis, source)
      : () => publicThis[source]
    : source.bind(publicThis, publicThis)
  let cb
  if (isFunction(value)) {
    cb = value
  } else {
    cb = value.handler as Function
    options = value
  }
  const cur = currentInstance
  setCurrentInstance(this)
  const res = doWatch(getter, cb.bind(publicThis), options)
  if (cur) {
    setCurrentInstance(cur)
  } else {
    unsetCurrentInstance()
  }
  return res
}

export function createPathGetter(ctx: any, path: string) {
  const segments = path.split('.')
  return () => {
    let cur = ctx
    for (let i = 0; i < segments.length && cur; i++) {
      cur = cur[segments[i]]
    }
    return cur
  }
}

/**
 * 转换数据类型（感觉这里就是为了解构存在的嵌套，找到原始的数据）
 * @param value 
 * @param seen 
 * @returns 
 */
export function traverse(value: unknown, seen?: Set<unknown>) {
  // 如果 value 不是对象，或者 value 是 skip 类型的（也就是永远不可能变成响应式数据），直接返回
  if (!isObject(value) || (value as any)[ReactiveFlags.SKIP]) {
    return value
  }
  seen = seen || new Set()
  if (seen.has(value)) {
    return value
  }
  seen.add(value)
  if (isRef(value)) {
    traverse(value.value, seen)
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (isSet(value) || isMap(value)) {
    value.forEach((v: any) => {
      traverse(v, seen)
    })
  } else if (isPlainObject(value)) {
    for (const key in value) {
      traverse((value as any)[key], seen)
    }
  }
  return value
}
