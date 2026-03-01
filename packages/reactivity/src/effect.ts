import { TrackOpTypes, TriggerOpTypes } from './operations'
import { extend, isArray, isIntegerKey, isMap } from '@vue/shared'
import { EffectScope, recordEffectScope } from './effectScope'
import {
  createDep,
  Dep,
  finalizeDepMarkers,
  initDepMarkers,
  newTracked,
  wasTracked
} from './dep'
import { ComputedRefImpl } from './computed'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

// The number of effects currently being tracked recursively.
let effectTrackDepth = 0

export let trackOpBit = 1

/**
 * The bitwise track markers support at most 30 levels of recursion.
 * This value is chosen to enable modern JS engines to use a SMI on all platforms.
 * When recursion depth is greater, fall back to using a full cleanup.
 */
const maxMarkerBits = 30

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: ReactiveEffect
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

/**
 * 创建 effect 实例的构造函数
 */
export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = []
  parent: ReactiveEffect | undefined = undefined

  /**
   * Can be attached after creation
   * @internal
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   */
  allowRecurse?: boolean
  /**
   * @internal
   */
  private deferStop?: boolean

  onStop?: () => void
  // dev only
  onTrack?: (event: DebuggerEvent) => void
  // dev only
  onTrigger?: (event: DebuggerEvent) => void

  /**
   * 这里有个 ts 的语法糖
   * 当构造函数的参数中，添加 public、private 等关键词修饰时
   * 就相当于在实例中声明了一个同名的实例属性，并且将参数赋值给这个属性
   * @param fn 
   * @param scheduler 
   * @param scope 
   */
  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | null = null,
    scope?: EffectScope
  ) {
    recordEffectScope(this, scope)
  }

  run() {
    // 默认 active 是 true，所以这里无需返回（不知道是在干嘛）
    if (!this.active) {
      return this.fn()
    }
    let parent: ReactiveEffect | undefined = activeEffect
    let lastShouldTrack = shouldTrack
    while (parent) {
      if (parent === this) {
        return
      }
      parent = parent.parent
    }
    try {
      // 缓存上一个 effect 到实例的 parent 属性上（不知道是在干嘛）
      this.parent = activeEffect
      // 将当前的 effect 实例对象添加到 activeEffect 上
      activeEffect = this
      shouldTrack = true

      trackOpBit = 1 << ++effectTrackDepth

      if (effectTrackDepth <= maxMarkerBits) {
        initDepMarkers(this)
      } else {
        cleanupEffect(this)
      }
      // 返回 effect 方法接收的 fn 的执行结果
      return this.fn()
    } finally {
      if (effectTrackDepth <= maxMarkerBits) {
        finalizeDepMarkers(this)
      }

      trackOpBit = 1 << --effectTrackDepth

      activeEffect = this.parent
      shouldTrack = lastShouldTrack
      this.parent = undefined

      if (this.deferStop) {
        this.stop()
      }
    }
  }

  stop() {
    // stopped while running itself - defer the cleanup
    if (activeEffect === this) {
      this.deferStop = true
    } else if (this.active) {
      cleanupEffect(this)
      if (this.onStop) {
        this.onStop()
      }
      this.active = false
    }
  }
}

function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  lazy?: boolean
  scheduler?: EffectScheduler
  scope?: EffectScope
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

/**
 * 接收一个函数，当这个函数中的响应式数据发生变化时，fn 会被重新执行
 * @param fn 
 * @param options 
 * @returns 
 */
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions
): ReactiveEffectRunner {
  // 如果接受的 fn 的一个对象，并且存在 effect 属性（可不考虑）
  if ((fn as ReactiveEffectRunner).effect) {
    // 那么 fn 就等于 effect.fn，这说明 effect 也是一个对象
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  // 创建一个 _effect 实例对象（只需要把 fn 传递进去）
  const _effect = new ReactiveEffect(fn)
  // effect 还可以接收额外的参数（暂时也不考虑吧）
  if (options) {
    extend(_effect, options)
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  // 只有当存在配置参数，并且 lazy 是 true 的时候，才不会执行 run 方法
  // 因为这时代表着要延迟执行（这里是不管数据是否发生了变化，默认都要先执行一次）
  if (!options || !options.lazy) {
    _effect.run()
  }
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

/**
 * 收集依赖
 * @param target 被收集依赖的被代理对象
 * @param type 收集依赖类型
 * @param key 当前对象的 key
 * 
 * targetMap 的数据结构是：
 * 
 * const targetMap = new Map({
 *   // 被代理对象对应一个 Map
 *   targetObj1 -> DepsMap({
 *      // 对象的属性对应一个 Set（因为同一个属性可能在多个地方使用，所以 Set 中就会存在多个不可重复的 effect
 *      key1 -> DepSet,
 *      key2 -> DepSet,
 *      ...
 *   }),
 *   targetObj2 -> DepsMap,
 *   ...
 * })
 * 
 * 这样的设计可以保证，每个被代理对象的每个属性，所需要收集的依赖和对应的响应都清晰切独立可见
 */
export function track(target: object, type: TrackOpTypes, key: unknown) {
  // 是否存在 activeEffect，也就是对应的 effect 实例（其实这个属性就代表了有地方需要使用到这个属性）
  if (shouldTrack && activeEffect) {
    // 从 targetMap 中获取当前被代理对象是否存在依赖的 Map; target -> DepsMap
    let depsMap = targetMap.get(target)
    // 如果不存在，则添加一个 key 是 target，value 是 map 对象的映射
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    // 从 depsMap 中根据 key 查找 dep; key -> Set
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = createDep()))
    }

    const eventInfo = __DEV__
      ? { effect: activeEffect, target, type, key }
      : undefined

    trackEffects(dep, eventInfo)
  }
}

/**
 * 收集 effects
 * @param dep 
 * @param debuggerEventExtraInfo 
 */
export function trackEffects(
  dep: Dep,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  let shouldTrack = false
  if (effectTrackDepth <= maxMarkerBits) {
    if (!newTracked(dep)) {
      dep.n |= trackOpBit // set newly tracked
      shouldTrack = !wasTracked(dep)
    }
  } else {
    // Full cleanup mode.
    shouldTrack = !dep.has(activeEffect!)
  }

  if (shouldTrack) {
    // 将 activeEffect 收集起来
    dep.add(activeEffect!)
    // 这里还有个双向收集（理由是什么？？？）
    activeEffect!.deps.push(dep)
    if (__DEV__ && activeEffect!.onTrack) {
      activeEffect!.onTrack({
        effect: activeEffect!,
        ...debuggerEventExtraInfo!
      })
    }
  }
}

/**
 * 触发依赖更新
 * @param target 被代理对象
 * @param type 触发更新的类型
 * @param key 触发更新的 key
 * @param newValue 更新的新值
 * @param oldValue 更新前的值
 * @param oldTarget 
 * @returns 
 */
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  // 从 targetMap 中取出 target 被代理对象曾经收集到的依赖 Map
  const depsMap = targetMap.get(target)
  // 如果没有被收集，直接返回（这里的场景应该是，定义了这个属性，但是没有使用的地方，只有修改的地方）
  if (!depsMap) {
    // never been tracked
    return
  }

  let deps: (Dep | undefined)[] = []
  if (type === TriggerOpTypes.CLEAR) {
    // 集合（Map、Set）被清空了，应该执行数据的值对应的所有 effect
    // map.values 拿到所有 value 的迭代器，然后转成数组
    deps = [...depsMap.values()]
  } else if (key === 'length' && isArray(target)) {
    // 如果当前修改的是数组的 length 属性
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        deps.push(dep)
      }
    })
  } else {
    // 修改的是对象的 key，根据 key 取出对应的 deps
    if (key !== void 0) {
      deps.push(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes
          deps.push(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const eventInfo = __DEV__
    ? { target, type, key, newValue, oldValue, oldTarget }
    : undefined

  // 如果 deps 只有一个（这次数据更新操作只影响到了单个数据的结果）
  if (deps.length === 1) {
    if (deps[0]) {
      if (__DEV__) {
        triggerEffects(deps[0], eventInfo)
      } else {
        // 触发当前 key 对应的依赖
        triggerEffects(deps[0])
      }
    }
  } else {
    const effects: ReactiveEffect[] = []
    // 当前修改，肯定是影响到了多个数据的结果（比如数组的批量操作）
    for (const dep of deps) {
      if (dep) {
        // 拿到每个数据的 dep Set，下面在使用 createDep 将多个 effect 合并成一个 dep
        // 其实就是将多个 dep 合并成一个 dep
        effects.push(...dep)
      }
    }
    if (__DEV__) {
      triggerEffects(createDep(effects), eventInfo)
    } else {
      triggerEffects(createDep(effects))
    }
  }
}

/**
 * 触发传递进来的 dep，其中 dep 是一个包含了多个且不重复的 activeEffect 集合
 * @param dep 
 * @param debuggerEventExtraInfo 
 */
export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // 将集合扩展成普通数组
  const effects = isArray(dep) ? dep : [...dep]
  // 执行数据变化后，需要重新运行的 effectFn，不过要区分是否是 computed
  for (const effect of effects) {
    if (effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo)
    }
  }
  for (const effect of effects) {
    if (!effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo)
    }
  }
}

/**
 * 触发 effect 执行
 * @param effect 
 * @param debuggerEventExtraInfo 
 */
function triggerEffect(
  effect: ReactiveEffect,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // 为什么 effect 不能等于 activeEffect ???
  if (effect !== activeEffect || effect.allowRecurse) {
    if (__DEV__ && effect.onTrigger) {
      effect.onTrigger(extend({ effect }, debuggerEventExtraInfo))
    }
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      // 执行 run 方法，也就是传递过来的 fn
      effect.run()
    }
  }
}
