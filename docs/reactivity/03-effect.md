## effect 核心代码

> 这部分内容承载了数据依赖的收集，以及数据变化时，对应依赖的触发和更新

`PATH: /packages/reactivity/src/effect.ts`

#### effect

```ts
export function effect<T = any>(fn: () => T): ReactiveEffectRunner {
  // 创建 _effect 实例，将 effect 方法接受的 fn 参数传递进去
  const _effect = new ReactiveEffect(fn)
  // 执行 _effect 实例的 run 方法
  _effect.run()
}
```

#### ReactiveEffect

```ts
export let activeEffect

export class ReactiveEffect {
  constructor(public fn: () => T) {}

  run() {
    activeEffect = this
    return this.fn()
  }
}
```
其实 `effect` 的源码实现核心功能非常简单，主要就是创建一个 `_effect` 实例，然后实例中拥有 `effect` 方法执行时接收的参数，还有一个 `run` 方法。

根据源码也不难看出，在调用 `effect` 方法时，会默认直接执行一次参数 `fn`。

这里有一个 `activeEffect` 很重要，他会缓存起来当前的 `effect` 实例对象，后面在依赖收集的时候会使用到。

#### track

```ts
export function track(target: object, key: unknown) {
  if (activeEffect) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = createDep()))
    }
    trackEffects(dep)
  }
}
```

在 `proxy` 的 `getter` 中，可以看到会调用 `track` 方法，这个方法的作用就是，在访问**响应式属性**的时候，开始**收集依赖**

其中 `targetMap` 是一个 `Map` 类型的对象，这个 `map` 对象中，`key` 对应的是 `target` 也就是被代理对象，`value` 对应的是一个 `Map` 对象，代码中叫 `depsMap`。
含义就是，给当前被代理对象创建一个 `Map`，用于存储这个对象对应的依赖集合。

但是光知道对象对应的依赖是不够的，还需要知道对象中每个属性对应的具体依赖分别是什么，要区分开。

所以 `depsMap` 中，`key` 对应的就是 `target.key`，`value` 就是一个 `Set`，这里的 `Set` 是根据 `createDep()` 创建的，这个方法内部其实就是执行了 `new Set()` 并返回。

然后就开始收集 `effect` 到 `dep` 中。

#### trackEffects

```ts
export function trackEffects(dep: Dep) {
  dep.add(activeEffect!)
  activeEffect!.deps.push(dep)
}
```

将 activeEffect 收集起来。至此，依赖收集的工作已经完成了！

#### trigger

```ts
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    return
  }

  let deps: (Dep | undefined)[] = []
  // 根据不同情况，取出对应的依赖 dep，笔记中只列出修改对象的 key 一种情况 ...
  deps.push(depsMap.get(key))

  if (deps.length === 1) {
    if (deps[0]) {
      triggerEffects(deps[0])
    }
  } else {
    const effects: ReactiveEffect[] = []
    // 当前修改，肯定是影响到了多个数据的结果（比如数组的批量操作）
    for (const dep of deps) {
      if (dep) {
        effects.push(...dep)
      }
    }
    triggerEffects(createDep(effects))
  }
}
```

在 `proxy` 的 `setter` 中，可以看到会调用 `trigger` 方法，这个方法的含义就是，当数据发生了变化，需要根据变化的数据，取出曾经收集起来的所有 `_effect`，然后重新执行他们，达到页面更新的效果。

核心代码是，首先根据被代理对象找到对应的依赖集合。

如果没有，就什么都不执行。这里的场景应该是定义的数据被手动修改了，从而触发 `setter`，但是由于这个被修改的属性从来没有被使用过，所以就找不到对应的 `_effect`，因而不需要做任何处理。

然后根据修改的 `key` 获取收集起来的所有依赖（这里实现的稍微有点负责，可能考虑了各种边界情况，或者其他类型数据的情况，暂时没看懂 2026-03-01），这里只讨论修改的是对象某个属性的情况。根据 `key` 在 `map` 中取出对应的 `set` 集合。

然后执行 `set` 集合中的 `_effect`。

#### triggerEffects

```ts
export function triggerEffects(
  dep: Dep | ReactiveEffect[],
) {
  const effects = isArray(dep) ? dep : [...dep]
  for (const effect of effects) {
    triggerEffect(effect)
  }
}
```

方法中，拿到 `dep` 也就是 `_effect` 的集合，转成数组，然后分别执行。

#### triggerEffect

```ts
function triggerEffect(
  effect: ReactiveEffect,
) {
  if (effect !== activeEffect || effect.allowRecurse) {
    effect.run()
  }
}
```

执行每个 `effect.run` 方法，至此触发更新的部分就已经结束了。


