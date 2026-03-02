## getter 中数组的特殊处理

在 `reactive` 的 `getter` 源码实现中，可以看到对于数组进行了特殊处理，具体特殊实现体现在 `createArrayInstrumentations` 方法中。

```ts
function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      const arr = toRaw(this) as any
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking()
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}
```

这段代码实现主要分为两部分：

- 针对数组的查询方法（搜索增强，在调用这几个方法时，无论是根据 proxy 还是 raw 都能查询出正确的结果，外加收集依赖，不过多讨论）
- 针对数组的修改方法（重点分析）

### 关于数组的修改方法

```ts
;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
  instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
    pauseTracking()
    const res = (toRaw(this) as any)[key].apply(this, args)
    resetTracking()
    return res
  }
})
```

先说结论：之所以调用了 `pauseTracking`（暂停追踪）和 `resetTracking`（恢复追踪），是为了解决数组操作中一个非常隐蔽的 **“无限递归/死循环”** 问题。

##### 🧐 为什么要暂停？（以 push 为例）

先看 `push` 的本质。当调用 `proxy.push(item)` 的时候，会发生下面**两件事儿**

1. 添加元素：在索引 `length` 的地方添加 `item`（触发了一次 `set`，这次是有意义的，因为确实添加了一个新的值）
2. 修改长度：隐式的读取并修改 `length` 属性（触发了一次 `set`，这次是多余的，也是造成问题的直接原因）

> 假设在 `effect` 方法中，执行了 `proxy.push(item)`，不暂停的情况下，会发生以下操作：

1. 执行 `push` 方法，首先会读取 `length` 属性
2. 触发 `getter` -> 收集依赖 `track(target, 'length')`
3. 结果就是 `effect` 莫名其妙的依赖上了 `length` 属性，并且被收集起来
4. 然后 `push` 就会修改 `length` 属性
5. 这时候又触发了 `setter` -> 触发依赖 `trigger(target, 'length')`
6. 触发依赖，就又开始执行 `effect.fn`，然后又执行了 `push`
7. 至此，形成**死循环**

##### 🙋 暂停和恢复的原理

暂停和恢复并不是清空依赖，而是通过一个全局开关让 `track` 暂时失效

```ts
// 简化后的源码逻辑
export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false // 关掉开关
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last !== undefined ? last : true // 恢复之前的状态
}
```

再回过头来看一下 `track` 方法最开始的判断条件：

```ts
export fucntion track(target, key) {
  if (shouldTrack && activeEffect) {}
}
```

`activeEffect` 最开始就明白了，目的是有依赖可以收集，而 `shouldTrack` 则是判断应不应该收集依赖

##### 🙋 push 等方法的重写逻辑拆解

1. `pauseTracking()` 把 `shouldTrack` 设置为 `false`
2. 执行原生的 `push` 方法
   - 原生的 `push` 方法内部访问 `length` 属性
   - 触发 `getter` -> 进入 `track`
   - 发现 `shouldTrack` 是 `false`，所以不执行 `track`
3. 原生的 `push` 修改 `length` 属性，触发 `trigger(target, 'length')`，但是发现没有找到对应的依赖，所以什么都不处理
4. `resetTracking()` 把 `shouldTrack` 恢复为 `true`

##### 🌟 结论

因为这些方法都会修改 `length` 属性，所以暂停和恢复的逻辑，可以理解为防止 `length` 属性的隐式访问和修改带来的死循环问题

##### 🤔 那 `item` 被添加发生了什么呢？

`item` 被添加就是触发了 `setter` 逻辑，虽然上面有了 `pauseTracking`，但是这只是暂停了 `track`，并没有暂停 `trigger`，`Vue` 自然会 `trigger` 使用了数组的地方。

如果被添加的 `item` 是一个对象，那也是在访问的时候才给变成了 `proxy`，而不是添加的时候，这就是 **`Vue3` 的 “懒代理”**。

```ts
// getter
if (isObject(res)) {
  return isReadonly ? readonly(res) : reactive(res)
}
```
