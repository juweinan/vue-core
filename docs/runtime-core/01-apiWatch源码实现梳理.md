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

关于 watch 方法的源码实现，非常简单，就是调用了一个 doWatch 方法。

但是这里要知道的是，watch 都支持那些参数，也就是关于 watch 的函数重载

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
}
```

先看 doWatch 中的第一部分源码实现，这部分源码宏观上理解就是处理 source 方法，然后将其封装成 getter 方法。

###### 1. source 是一个 Ref 类型的数据

那么 getter = () => source.value。

```ts
const count = ref(0)
watch(count, (newValue, oldValue) => {})
```

###### 2. source 是一个 Reactive 类型的数据

那么 getter = () => source。
并且这个时候的 watch 默认开启 deep 深度监听。

```ts
const data = reactive({
  count: 0
})
watch(data, () => {})
// watch(data, () => {}, { deep: true }) // 上面的代码等价于当前代码
```

###### 3. 如果 source 是一个 Array

标记一下这是多个 source 类型的 watcher。
并且 getter = () => sourceMapResult。
关于 sourceMapResult，就是遍历 source，每一项：

- 如果是一个 Ref，则修改为 ref.value
- 如果是一个 Reactive，则调用 traverse
- 如果是一个 Function，则调用 callWithErrorHandling 方法，执行当前的 source[i]，如果在执行的过程中有什么报错，他会帮助捕获。（所以 callWithErrorHandling 就是带有异常捕获的函数执行器）

```ts
watch([refData, reactiveData, () => otherData], () => {})
```

traverse 解释：

因为当前是 reactive 类型的数据，所以正常情况下只是触发了对象本身的 getter，如果修改了内部的属性，那么是没有对应的 trigger 可以触发的。

traverse 的作用是

同样的，这也说明，即使 source 是数组的时候，其中有一项数据是 Reactive 类型的，那么针对这个 Reactive 也是深度监听的

###### 4. 如果 source 是一个 Function

- 如果说传递了回调函数，那么通过 callWithErrorHandling 执行 source 并得到返回值。
getter = () => sourceFnResult。

```ts
watch(() => observeData, () => {})
```

- 如果没有传递回调函数，这种情况基本是通过 watchEffect 方法调用的。

```ts
watchEffect(() => {})
```

这个时候的 getter 方法中

- 判断当前实例（应该是 watchEffect 所在的组件实例）是否被挂载了，如果没有被挂载，那么就什么都不执行。
- cleanup 暂时不知道什么意思
- 执行 callWithAsyncErrorHandling，跟 callWithErrorHandling 相同的是，这也是会捕获 source 方法执行的错误，不同的是，这个是捕获异步结果的（不过这里的场景暂时也不太知道，或许后面能给出答案）

###### 5. source 既不是 Ref，也不是 Reactive，也不是 Array，也不是 Function

getter = () => {}

这是源码对于 watch 参数的兜底，一旦 getter 是这种情况，那么这个 watch 也就没有任何意义了