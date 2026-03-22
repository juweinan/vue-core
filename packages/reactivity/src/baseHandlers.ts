import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  isReadonly,
  isShallow
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend,
  makeMap
} from '@vue/shared'
import { isRef } from './ref'
import { warn } from './warning'

const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

const builtInSymbols = new Set(
  /*#__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    // ios10.x Object.getOwnPropertyNames(Symbol) can enumerate 'arguments' and 'caller'
    // but accessing them on Symbol leads to TypeError because Symbol is a strict mode
    // function
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

/**
 * 创建数组的工具方法
 * 其实就是将数组的原生方法进行重写，在重写的方法中添加了 track 和 pauseTracking 以及 resetTracking 这些函数的调用
 * 以便在调用这些方法时能够正确地进行依赖收集和触发更新（2026-02-28）
 * @returns 
 */
function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // instrument identity-sensitive Array methods to account for possible reactive
  // values
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // 获取代理对象的原始数据（这里的 this 指向的 receiver，在日常开发中，通常对应的就是 reactive 返回的代理对象）
      const arr = toRaw(this) as any
      // 遍历数组中的每一项，对于每一项都触发 track 依赖收集（收集的是数组的下标）
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      // 我们首先使用原始参数运行该方法（这可能是响应式的）
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        // 如果第一次运行的结果代表没找到，再用原始值遍历一遍（这可能是非响应式的）
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // 下面的方法会导致数组的长度发生变化，所以在调用这些方法时，
  // 先调用 pauseTracking 暂停依赖收集，等方法执行完之后，再调用 resetTracking 恢复依赖收集
  // 官方解释是防止某些情况下的无限循环（2026-02-28）
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking()
      // 使用原始数组调用原生方法
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}

/**
 * 创建一个 getter 函数，这个函数会被 reactive 和 readonly 以及 shallowReactive 和 shallowReadonly 这四种不同的代理对象所使用
 * @param isReadonly 是否只读
 * @param shallow 是否是浅层代理（只有第一层是响应式的）
 * @returns 
 */
function createGetter(isReadonly = false, shallow = false) {
  // 返回一个 get 方法：target 是被代理对象，key 是访问对象的属性，receiver 指向的是最初操作的那个对象（通常情况下都表示代理对象）
  return function get(target: Target, key: string | symbol, receiver: object) {
    // 是否是 reactive 代理对象
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
      // 是否是只读
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
      // 是否是浅层代理
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return shallow
    } else if (
      // 访问 __v_raw 属性，并且 recevier（代理对象）在缓存中存在，则直接返回 target
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
          ? shallowReactiveMap
          : reactiveMap
        ).get(target)
    ) {
      return target
    }

    // 被代理对象是否是数组
    const targetIsArray = isArray(target)

    // 如果不是只读，并且被代理对象是数组，当前访问的还是重写过的数组中的方法
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      // 从重写了数组方法的对象中读取 key，只不过方法中的 this 指向的是代理对象
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    // 当被代理对象是一个普通对象时（得到访问属性的值）
    const res = Reflect.get(target, key, receiver)

    // Symbol 暂时不管
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

    // 如果不是只读，触发 track（2026-02-28）
    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    // 如果是浅层代理，直接返回结果，不进行后续的响应式转换（以为只代理第一层即可）
    if (shallow) {
      return res
    }

    // 如果 res 的数据类型是通过 ref() 方法创建
    if (isRef(res)) {
      // 如果被代理对象是数组，并且访问的属性是一个整数索引，那么就直接返回 res，否则就返回 res.value
      // const proxy = reactive([ref(1), ref(2), ref(3)]); proxy[0] // ref(1)
      return targetIsArray && isIntegerKey(key) ? res : res.value
    }

    // 如果 res 是一个对象，也将它转换成响应式对象
    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      return isReadonly ? readonly(res) : reactive(res)
    }

    // 返回最后访问的属性值
    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

/**
 * 创建一个 setter 函数，这个函数会被 reactive 和 readonly 以及 shallowReactive 和 shallowReadonly 这四种不同的代理对象所使用
 * 这里没有 isReadonly 参数，那是因为只读的对象不可能修改属性，所以就不用考虑了，所以这个 setter 应该是只给 reactive 和 shallowReactive 这两种代理对象使用的
 * @param shallow 是否是浅层代理（只有第一层是响应式的）
 * @returns 
 */
function createSetter(shallow = false) {
  // 返回一个 set 方法：target 是被代理对象，key 是访问对象的属性，value 是要设置的值，receiver 是最初发起操作的对象，通常指的是 proxy 对象（代理对象）
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 获取被代理对象上访问属性的值（修改之前的值）
    let oldValue = (target as any)[key]
    // 详细理解查看 /docs/reactivity/02-reactive-core.md 中的 createSetter 部分第一段
    // 大概意思就是：如果旧的值是只读的和 Ref 对象，新的值又是不是 Ref 对象，那么就不允许修改
    // 因为在这种情况下，其实修改的是 oldValue.value，因为 oldValue 是 readonly，所以返回 false，表示修改失败
    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }
    // 如果是通过 reactive 创建的代理对象，并且新的值也不是只读的
    if (!shallow && !isReadonly(value)) {
      // 如果新的值不是浅层代理的对象
      if (!isShallow(value)) {
        // 将新的值和旧的值都转换成原始数据（如果它们是 reactive 或者 readonly 代理对象的话）
        // 直接将原始对象添加到对应的属性上（如果新的值是 shallow，就不能取原始对象了，因为那样会破坏 value 的 shallow 特性）
        value = toRaw(value)
        oldValue = toRaw(oldValue)
      }
      // 被代理对象不是数组，并且旧的值是 Ref 对象，新的值不是 Ref 对象
      // 那么就将新的值添加到旧的值的 value 属性上（这也就印证了上面的第一段的意思了）
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // 在浅模式中，对象会按原样设置，而不考虑是否具有响应性
    }

    // key 是否是有效的（当 target 是数组是，key 是否是 length 内的索引；如果是对象，key 是否是 target 上的属性）
    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    // 设置新的值到被代理对象上
    const result = Reflect.set(target, key, value, receiver)
    // 只有被代理对象就是 receiver 的原始对象时，才会触发更新
    // 不想等的情况，以及这块的边缘处理详见 /docs/reactivity/02-reactive-core.md 中的 createSetter 部分第二段
    if (target === toRaw(receiver)) {
      // 如果 key 在之前不存在，表示这是添加操作，触发新增的 trigger
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
        // 如果 key 存在，并且新的值和旧的值不一样，表示这是更新操作，触发更新的 trigger
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

/**
 * 调用 delete 关键词删除对象属性
 * @param target 
 * @param key 
 * @returns 
 */
function deleteProperty(target: object, key: string | symbol): boolean {
  // 被删除属性 key 是否存在
  const hadKey = hasOwn(target, key)
  // 被删除属性的 value
  const oldValue = (target as any)[key]
  // 在 target 上删除 key
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    // 如果删除是有意义的，触发删除的 trigger
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

/**
 * 调用 has 判断是否存在属性，主要是收集依赖
 * @param target 
 * @param key 
 * @returns 
 */
function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    // 调用 track（主要是收集依赖）
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

/**
 * 访问自身是否存在 key，也是收集依赖
 * @param target 
 * @returns 
 */
function ownKeys(target: object): (string | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}

// 当被代理对象是普通对象或者普通数组时，使用这个方法作为 proxy 的 handler
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

export const shallowReactiveHandlers = /*#__PURE__*/ extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers = /*#__PURE__*/ extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
