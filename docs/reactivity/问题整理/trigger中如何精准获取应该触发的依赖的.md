## trigger 方法中，如何精准获取应该出发的依赖的？

完整代码在 `packages/reactivity/src/effect.ts` 中的 `trigger` 实现中

```ts
let deps: (Dep | undefined)[] = []
if (type === TriggerOpTypes.CLEAR) {
  deps = [...depsMap.values()]
} else if (key === 'length' && isArray(target)) {
  depsMap.forEach((dep, key) => {
    if (key === 'length' || key >= (newValue as number)) {
      deps.push(dep)
    }
  })
} else {
  if (key !== void 0) {
    deps.push(depsMap.get(key))
  }

  switch (type) {
    case TriggerOpTypes.ADD:
      if (!isArray(target)) {
        deps.push(depsMap.get(ITERATE_KEY))
        if (isMap(target)) {
          deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
        }
      } else if (isIntegerKey(key)) {
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
```

这是一段非常复杂的代码，在第一次阅读的时候，就在想：为什么不能直接根据 `key` 去查找对应的 `dep` 呢？

#### 结论

因为在 `js` 中，**一个动作往往会产生连锁反应**。

所以这段代码的核心就是，**一个操作发生时，除了直接关联的 `key`，是不是还有其他隐藏的依赖也被触发了？** 

就比如前面了解的数组的 `push` 操作除了会在 `length` 位置添加新的数据，还会隐式的修改 `length` 属性。

将上面这大段代码分三个最具代表性的场景来分析：

#### 1. 数组的 “牵一发而动全身” key === 'length'

```ts
if (key === 'length' && isArray(target)) {
  depsMap.forEach((dep, key) => {
    if (key === 'length' || key >= (newValue as number)) {
      deps.push(dep)
    }
  })
}
```

- 场景：如果执行了 `arr.length = 1` (之前的 `length` 是 `100`)
- 逻辑：
  1. 代码中显示依赖 `length` 的 `effect` 肯定是要跑的
  2. 关键，那些依赖了 `arr[1]`，`arr[50]` 的 `effect` 也需要跑，因为 `length` 缩短，就意味着那些索引对应的值被删除了
- 作用：当明确知道手动缩短数组时，那些观察（使用）了具体值的地方（视图）就要更新

#### 2. 新增属性引发的“隐形依赖” add 场景

```ts
case TriggerOpTypes.ADD:
  if (!isArray(target)) {
    // 对象的遍历依赖 v-for="val in obj"
    deps.push(depsMap.get(ITERATE_KEY))
  } else if (isIntegerKey(key)) {
    // 数组新增了索引 -> 长度必然变了
    deps.push(depsMap.get('length'))
  }
  break
```
- 场景 A（对象）：如果在 `effect` 中写了 `Object.keys(obj)`，`Vue` 会内部手机一个特殊的 `ITERATE_KEY`。当你执行 `obj.newProp = 1` 时，虽然 `newProp` 是新的，但对象的键名列表变了，所以必须把 `ITERATE_KEY` 对应的 `effect` 取出来跑一遍。
- 场景 B（数组）：如果你执行了 `arr[10] = 'new'`.
  - 直接依赖 `arr[10]` 的要跑
  - 连带逻辑，数组的长度变了，所以还必须把依赖 `length` 的 `effect` 也取出来跑一遍

#### 3. 迭代器的特殊处理（ITERATE_KEY）

```ts
case TriggerOpTypes.DELETE:
  if (!isArray(target)) {
    deps.push(depsMap.get(ITERATE_KEY))
  }
```

- 场景：`delete obj.a`
- 逻辑：删除一个属性不仅影响属性本身，还会影响对象遍历的结果，所以同样要出发 `ITERATE_KEY`

#### 为什么要搞这么复杂呢？

如果没有这段逻辑：

在页面上写一个 `v-for` 遍历一个数组，然后通过 `arr.length = 0` 清空数组。如果没有场景 1 中的 `forEach` 逻辑，页面上的列表就不会消失，因为 `v-for` 依赖的是数组的各个索引，而你只修改了 `length` 属性

## 面试 Tips

面试官：`Vue3` 是如何处理数组长度变化的响应式的？

```md
在 trigger 中，Vue 会对 length 属性做特殊处理，如果修改了 length 属性，那么会遍历数组，将大于新 length 的属性的 deps 全部取出来执行一遍。如果添加了新的值，也会更新 length 属性，从而触发相应的依赖
```
