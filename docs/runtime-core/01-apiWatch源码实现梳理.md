## watch 方法

```ts
export function watch<T = any, Immediate extends Readonly<boolean> = false>(
  source: T | WatchSource<T>,
  cb: any,
  options?: WatchOptions<Immediate>
): WatchStopHandle {
  return doWatch(source as any, cb, options)
}
```

关于 `watch` 方法的源码实现，非常简单，就是调用了一个 `doWatch` 方法。

但是这里要知道的是，`watch` 都支持那些参数，也就是关于 `watch` 的函数重载

## doWatch

#### 第一部分，将 source 处理成 getter

```ts
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb: WatchCallback | null,
  { immediate, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ
): WatchStopHandle {
  let getter: () => any
  let forceTrigger = false
  let isMultiSource = false

  if (isRef(source)) {
    getter = () => source.value
    forceTrigger = isShallow(source)
  } else if (isReactive(source)) {
    getter = () => source
    deep = true
  } else if (isArray(source)) {
    isMultiSource = true
    forceTrigger = source.some(s => isReactive(s) || isShallow(s))
    getter = () =>
      source.map(s => {
        if (isRef(s)) {
          return s.value
        } else if (isReactive(s)) {
          return traverse(s)
        } else if (isFunction(s)) {
          return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
        } else {
        }
      })
  } else if (isFunction(source)) {
    if (cb) {
      getter = () =>
        callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
    } else {
      getter = () => {
        if (instance && instance.isUnmounted) {
          return
        }
        if (cleanup) {
          cleanup()
        }
        return callWithAsyncErrorHandling(
          source,
          instance,
          ErrorCodes.WATCH_CALLBACK,
          [onCleanup]
        )
      }
    }
  } else {
    getter = NOOP
  }

  if (cb && deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter())
  }
}
```

先看 `doWatch` 中的第一部分源码实现，这部分源码宏观上理解就是处理 `source` 方法，然后将其封装成 `getter` 方法。

###### 1. source 是一个 Ref 类型的数据

那么 `getter = () => source.value`。

```ts
const count = ref(0)
watch(count, (newValue, oldValue) => {})
```

###### 2. source 是一个 Reactive 类型的数据

那么 `getter = () => source`。
并且这个时候的 `watch` 默认开启 `deep` 深度监听。

```ts
const data = reactive({
  count: 0
})
watch(data, () => {})
// watch(data, () => {}, { deep: true }) // 上面的代码等价于当前代码
```

如果光看到这里，其实是存在疑问的。因为 `source` 是 `Reactive`，然后默认开启了深度监听，但是这里的 `getter` 只访问了 `source`，所以也只是针对 `source` 对象本身进行了依赖收集，但是并没有对内部的所有属性进行依赖收集，在修改对象的某个属性时，并不能触发更新。

不过下面其实有做处理：

```ts
if (cb && deep) {
  const baseGetter = getter
  getter = () => traverse(baseGetter())
}
```

在这个判断条件中，如果传递了回调，并且还是深度监听，那么就会使用 `traverse` 对 `getter` 的返回值，也就是当前条件中的 `reactvie` 类型的 `source` 每个属性都访问一次，这样会收集起来所有的 `getter`，那么在修改属性的时候，就会触发对应的 `trigger`，从而完成更新。

不过，在实际开发中，还是要尽量监听响应式对象中的某个指定属性，因为 `traverse` 过程中要检索到每个属性，然后收集依赖，这是一个比较消耗性能的地方。

###### 3. 如果 source 是一个 Array

标记一下这是多个 `source` 类型的 `watcher`。
并且 `getter = () => sourceMapResult`。
关于 `sourceMapResult`，就是遍历 `source`，每一项：

- 如果是一个 `Ref`，则修改为 `ref.value`
- 如果是一个 `Reactive`，则调用 `traverse`
- 如果是一个 `Function`，则调用 `callWithErrorHandling` 方法，执行当前的 `source[i]`，如果在执行的过程中有什么报错，他会帮助捕获。（所以 `callWithErrorHandling` 就是带有异常捕获的函数执行器）

```ts
watch([refData, reactiveData, () => otherData], () => {})
```

`traverse` 解释：

因为当前是 `reactive` 类型的数据，所以正常情况下只是触发了对象本身的 `getter`，如果修改了内部的属性，那么是没有对应的 `trigger` 可以触发的。

`traverse` 的作用是访问对象内部的所有属性，然后这样每个属性都可以进入 `getter` 的逻辑，从而收集依赖，这样的话，在修改某个属性值的时候，就会触发对应的 `trigger`，从而完成更新。

同样的，这也说明，即使 `source` 是数组的时候，其中有一项数据是 `Reactive` 类型的，那么针对这个 `Reactive` 也是深度监听的

###### 4. 如果 source 是一个 Function

- 如果说传递了回调函数，那么通过 `callWithErrorHandling` 执行 `source` 并得到返回值。
  `getter = () => sourceFnResult`。

```ts
watch(
  () => observeData,
  () => {}
)
```

- 如果没有传递回调函数，这种情况基本是通过 `watchEffect` 方法调用的。

```ts
watchEffect(() => {})
```

这个时候的 `getter` 方法中

- 判断当前实例（应该是 `watchEffect` 所在的组件实例）是否被挂载了，如果没有被挂载，那么就什么都不执行。
- cleanup 就是给 `watchEffect` 一个后悔药，在后面执行方法的时候，能够清楚前面未执行完的任务（比如后面的请求执行完了，但是前面的请求还没执行完，但是前面的请求已经没有意义了，所以就可以通过这种方式结束掉前面的请求），从而避免内存泄漏。
- 执行 `callWithAsyncErrorHandling`，跟 `callWithErrorHandling` 相同的是，这也是会捕获 `source` 方法执行的错误，不同的是，这个是捕获异步结果的（不过这里的场景暂时也不太知道，或许后面能给出答案）

###### 5. source 既不是 Ref，也不是 Reactive，也不是 Array，也不是 Function

`getter = () => {}`

这是源码对于 `watch` 参数的兜底，一旦 `getter` 是这种情况，那么这个 `watch` 也就没有任何意义了

#### 第二部分，job 函数的实现

```ts
const job: SchedulerJob = () => {
  if (!effect.active) {
    return
  }
  if (cb) {
    const newValue = effect.run()
    if (
      deep ||
      forceTrigger ||
      (isMultiSource
        ? (newValue as any[]).some((v, i) =>
            hasChanged(v, (oldValue as any[])[i])
          )
        : hasChanged(newValue, oldValue)) ||
      (__COMPAT__ &&
        isArray(newValue) &&
        isCompatEnabled(DeprecationTypes.WATCH_ARRAY, instance))
    ) {
      if (cleanup) {
        cleanup()
      }
      callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
        newValue,
        oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
        onCleanup
      ])
      oldValue = newValue
    }
  } else {
    effect.run()
  }
}
```

关于这段代码：

首先判断 `effect` 是不是还处于激活状态，防止 `effect` 被 `stop` 了，如果不是激活状态，那么就什么都不处理，直接返回。

下面分两种情况讨论，一种是存在 `cb`，也就是通过 `watch` 调用的，还有一种是没有 `cb`，那么就是通过 `watchEffect` 调用的。

###### 1. 通过 watch 调用的

先执行 `effect.run()`，这里的 `effect` 其实是根据 `source` 格式化后的 `getter` 创建的，因为 `source` 中访问的是被监听的属性，所以得到的 `newValue` 也就是被监听属性的新值。
因为执执行了 `run`，所以 `activeEffect` 就等于当前 `effect`，然后 `source` 中的属性就跟这个 `effect` 关联起来了

如果是深度监听、或者强制触发更新、再或者是不管单个还是多个 `source`，新的值和旧的值发生了变化的时候，进入下面的逻辑
首先清除上一次的 `watch`（如果有的话），然后执行 `cb`，这里调用的是 `callWithAsyncErrorHandling` 这个函数，内部会自动捕获执行 `cb` 时产生的错误信息。

###### 2. 通过 watchEffect 调用的

直接执行 `effect.run()`，这里相当于就只处理了 `activeEffect`，然后执行 `fn`，开始 `track` 和 `trigger` 那一套流程了。

这部分代码目前只是定义出来了，但是还没有用到，包括里面的 `effect`，其实是在下一步才会实例化的。

#### 第三部分，实例化 effect

```ts
let scheduler: EffectScheduler
if (flush === 'sync') {
  // watchSyncEffect
  scheduler = job as any // the scheduler function gets called directly
} else if (flush === 'post') {
  // watchPostEffect
  scheduler = () => queuePostRenderEffect(job, instance && instance.suspense)
} else {
  // default: 'pre'
  scheduler = () => queuePreFlushCb(job)
}

const effect = new ReactiveEffect(getter, scheduler)

if (cb) {
  if (immediate) {
    job()
  } else {
    oldValue = effect.run()
  }
} else if (flush === 'post') {
  queuePostRenderEffect(effect.run.bind(effect), instance && instance.suspense)
} else {
  effect.run()
}

return () => {
  effect.stop()
  if (instance && instance.scope) {
    remove(instance.scope.effects!, effect)
  }
}
```

这是 `doWatch` 方法中的最后一部分

`job.allowRecurse = !!cb` 这一步是什么意思，暂时没太弄明白

然后是将 `job` 处理成 `scheduler` 调度器函数，前两个分别是 `wathcSyncEffect` 和 `watchPostEffect`，不过这个感觉在开发中根本没用过，要不是看源码，都不知道有这个属性
所以暂时只针对默认的情况来讨论。

默认情况下，`scheduler` 是把 `job` 用 `queuePreFlushCb` 方法包装了一下，不过这个方法暂时先不看，因为在 `computed` 的学习中，了解到 `scheduler` 是在触发的时候才会执行。

这里只需要知道 `queuePreFlushCb` 方法主要是将 `job` 添加到一个待办任务队列中，然后创建一个 `promise`，并在 `then` 中去重，执行 `job`。

实例化 `effect`，`getter` 和 `scheduler` 作为参数穿进去，`job` 中访问的 `effect` 就是这里面的 `effect`。

下一步，又是针对 `watch` 和 `watchEffect` 的分别处理。

如果存在 `cb`，也就是 `watch` 方法执行时，添加了 `immediate` 配置属性，直接执行 `job`。然后就是执行 `effect.run()` 方法，完成被监听属性和 `getter` 的相互收集，并拿到新的结果，因为这代表了第一次执行，`oldValue` 是初始化的默认值，所以数据肯定发生了变化，然后执行 `cb`（这里暂时就理解为执行了 `cb`，暂不考虑异步的情况，因为关于把 `cb` 异步化其实是在 `queuePreFlushCb` 这个方法中）。
如果没有添加 `immediate` 属性，就执行 `effect.run()` 方法，目的依然是建立依赖关系，拿到旧的值（用于后面比较数据是否发生变化）

如果不存在 `cb`，也就是 `watchEffect` 方法，那么就跟 `effect` 一样的逻辑，直接执行，建立依赖关系，只要依赖的属性变化了，就重新执行（永动机）。

最后返回一个函数，这个函数在执行的时候，会停止 `effect`，并把 `effect` 从 `scope.effects` 中移除（也就是关闭掉 `watch` 的监听）

至此 `doWatch` 函数执行完毕了。

## 案例分析

```ts
import { ref, watch } from 'vue'

const count = ref(0)

watch(count, val => {
  console.log('watch 执行了:', val)
})

// 同步修改三次
count.value++
count.value++
count.value++

console.log('同步代码结束')
```

首先执行 `ref` 方法，这里主要就是实例化 `RefImpl` 构造函数，同时创建一个 `get` 方法，方便后续访问 `ref.value` 的时候收集依赖。

然后执行 `watch` 方法，源码中直接调用的 `doWatch`，在 `doWatch` 中，首先是将 `source` 处理成 `getter`，因为 `source` 是 `Ref` 类型的数据，所以 `getter = () => count.value`。

创建一个 `job` 方法，实例化 `effect`，其中 `getter` 就是上面处理过的，`scheduler` 就是 `queuePreFlushCb` 包装过的 `job`。值得注意的一点是，此时的 `scheduler` 中包含了对 `cb` 的执行处理。

然后因为存在 `cb`，也不是 `immediate`，所以执行 `effect.run`，先建立 `count.value` 和 `effect` 之间的依赖关系，并拿到 `oldValue`。

至此，测试代码中的 `watch` 在源码中的执行就已经结束了。控制台打印 “同步代码执行结束”。

然后开始执行 `count.value++`。因为 `count.value` 发生了变化，进入到了 `triggerRefValue` 中，最后执行 `triggerEffect`。因为这个 `effect` 在实例化的时候传递了 `scheduler`，也就是包装后的 `job` 方法，所以执行 `scheduler`，等价于执行 `queuePreFlushCb(job)`。

## queuePreFlushCb

```ts
export function queuePreFlushCb(cb: SchedulerJob) {
  queueCb(cb, activePreFlushCbs, pendingPreFlushCbs, preFlushIndex)
}
```

这步方法，其实主要就是调用 `queueCb`，目的是将 `job` 添加到 `pre` 类型的待办任务队列中。

```ts
function queueCb(
  cb: SchedulerJobs,
  activeQueue: SchedulerJob[] | null,
  pendingQueue: SchedulerJob[],
  index: number
) {
  if (!isArray(cb)) {
    if (
      !activeQueue ||
      !activeQueue.includes(cb, cb.allowRecurse ? index + 1 : index)
    ) {
      pendingQueue.push(cb)
    }
  } else {
    pendingQueue.push(...cb)
  }
  queueFlush()
}
```

将 `job` 添加到队列中的具体实现。

单个 `job` 推入队列的判断条件意思是：如果正在执行的队列中存在 `job` 了，那么就直接跳过不重复添加。
这个步骤存在的意义是，当 `watch` 中修改了监听的值，则不重复触发更新。

然后开始执行任务

```ts
function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}
```

这个方法中，会打开一个是否正在等待执行的开关，然后创建一个 `fulfilled` 状态的 `promise`，然后 `flushJobs` 会作为 `then` 的回调函数执行，
也就是说，到这里为止，`scheduler () => queuePreFlushCb(job)` 的同步任务已经执行结束了。
重要的是 `flushJobs` 会作为微任务添加到微任务队列中。

然后在第 2，3 次执行的时候，再次触发 `trigger`，同样的执行 `scheduler`，将任务添加到待办任务队列中，但是执行到 `queueFlush` 方法的时候，发现判断条件不成立，就直接结束了（目的是只创建一个 `promise` 就够了）。

至此同步任务已经全部执行完毕，开始执行微任务 `flushJobs`。

```ts
function flushJobs(seen?: CountMap) {
  isFlushPending = false
  isFlushing = true
  flushPreFlushCbs(seen)
}
```

执行微任务，第一步是先将是否存在待执行任务设置为 `false`，并且标记正在执行任务。
然后调用 `flushPreFlushCbs` 方法。

```ts
export function flushPreFlushCbs(
  seen?: CountMap,
  parentJob: SchedulerJob | null = null
) {
  if (pendingPreFlushCbs.length) {
    currentPreFlushParentJob = parentJob
    activePreFlushCbs = [...new Set(pendingPreFlushCbs)]
    pendingPreFlushCbs.length = 0

    for (
      preFlushIndex = 0;
      preFlushIndex < activePreFlushCbs.length;
      preFlushIndex++
    ) {
      activePreFlushCbs[preFlushIndex]()
    }
    activePreFlushCbs = null
    preFlushIndex = 0
    currentPreFlushParentJob = null
    flushPreFlushCbs(seen, parentJob)
  }
}
```

在这个方法中，首先判断 `pendingPreFlushCbs` 是否有值，这个队列就是最开始 `push job` 的数组，然后用 `Set` 完成数组去重，并赋值给 `activePreFlushCbs`。
清空 `pendingPreFlushCbs` 然后遍历 `activePreFlushCbs` 并执行每一个 `job`。

这个时候，虽然改变了三次，但是经过数组去重其实只有一个 `job` 需要执行，又因为这是微任务，所以拿到的 `newValue` 是最终的结果。

这里要说明一下原生的 `effect` 和 `watch` 在这个案例里的不同

在原生 `effect` 中，因为没有 `new Set(joblist)`，所以会执行三次，也因为没有 `Promise.resolve().then()`，所以是同步执行的。

