## 串通流程

> 至此阶段，已经完成了 `reactive`、`effect` 方法源码的阅读，通过以下示例代码，全流程理解以下数据的响应式逻辑，以及排查以下是否还存在什么问题

```js
<div id="app"></div>

import { reactive, effect } from 'Vue'

const proxy = reactive({
  name: 'wangdaxun',
})

effect(() => {
  document.querySelector('#app').innerText = proxy.name
})

setTimeout(() => {
  proxy.name = 'wanggenji'
}, 2000)
```

逐行分析上面的代码...

#### 首先执行到了 reactive

```ts
export function reactive(target) {
  return createReactiveObject(
    target,
    mutableHandlers,
    reactiveMap
  )
}
```

在源码实现中，调用 `reactive` 方法其实就是执行了 `createReactiveObject` 方法。

```ts
export 

function createReactiveObject(target, baseHandlers, proxyMap) {
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }

  const proxy = new Proxy(
    target,
    mutableHandlers
  )

  proxyMap.set(target, proxy)

  return proxy
}
```

在 `createReactiveObject` 核心代码中，创建响应式对象前需要先在缓存中读取，目的是针对同一个被代理对象只创建一个代理对象。

如果没有的话，则通过 `Proxy` 创建代理对象，然后缓存起来，并返回代理对象。

至此 `reactive` 功能已经结束了。因为 `getter` 和 `setter` 暂时还没触发，所以暂不解读。

#### 然后执行到 effect

```ts
export function effect(fn: () => T) {
  const _effect = new ReactiveEffect(fn)
  _effect.run()
}
```

```ts
let activeEffect

class ReactiveEffect {
  constructor(public fn) {}

  run() {
    activeEffect = this
    return this.fn()
  }
}
```

在执行 `effect` 方法的时候，内部实现是创建了一个 `_effect` 实例，并将 `fn` 作为实例的属性在实例化的时候传递进去。然后直接执行 `run` 方法，这表示，`effect` 在使用的时候，默认就会执行执行一遍传进来的函数参数。

这里还有一个重要的点，就是第一次默认执行后，就会将当前的 `_effect` 实例添加到 `activeEffect` 属性上。

至此，`effect` 方法的实现也全部结束了。

#### 执行 effect.fn

```ts
document.querySelector('#app').innerText = proxy.name
```

因为 `effect` 默认会执行一次 `fn`，所以在执行这行代码的时候，可以看到访问了响应式对象的 `proxy.name` 属性，这就顺利进入到了 `proxy` 的 `getter` 拦截器中。

```ts
const get = createGetter()
const set = createSetter()

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
}
```

#### createGetter

```ts
function createGetter() {
  return function get(target: object, key: string | symbol, recevier: object) {
    const res = Reflect.get(target, key, receiver)
    track(target, key)
    return res
  }
}
```

在 `getter` 中，会执行一个叫 `track` 的方法，这个方法的目的就是收集依赖。

#### track

```ts
const targetMap = new WeakMap<any, KeyToDepMap>()

export function track(target, key) {
  if (activeEffect) {
    const depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }

    const dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = new Set()))
    }

    trackEffects(dep)
  }
}
```

```ts
export function trackEffects(dep) {
  dep.add(activeEffect!)
}
```

在收集依赖的实现中，首先判断是否存在可以被收集的依赖。根据当前测试代码，可知在 `effect` 第一次执行时，就将 `_effect` 赋值给 `activeEffect` 了，所以是可以开始收集依赖的。

关于存储依赖的数据结构是：

首先有个 `map` 对象用于存储所有对象的依赖，这个 `map` 的 `key` 是每个 `target`，值就是对应的 `map` 对象，因此 `target` 和他的 `map` 是一对一的关系。这里整体的 `map` 设置成 `weakMap` 的理由是，如果什么时候，删除掉了这个 `target`，那么就会自然被垃圾回收机制回收了。

光有 `target` 对应的 `map` 存储所有依赖集合还是不行的，需要知道 `target` 对象中每个属性对应的 `dep` 分别是什么。

所以这个 `map` 里面的数据结构是，`key` 对应的 `target.key`，值是一个集合，用于存储当前 `key` 对应的所有依赖收集。

数据结构创建好了，然后就调用 `trackEffects` 方法，将 `activeEffect` 收集起来。

至此，`target` 对应的 `key` 的 `_effect` 收集依赖工作已经完成了。

#### 执行 setTimeout

```js
proxy.name = 'wanggenji'
```

两秒后，执行了这行代码，触发了代理对象的 `setter` 拦截。

#### createSetter

```ts
function createSetter() {
  return function set(target: object, key: string | symbol, value: unknow, receiver: object) {
    const res = Reflect(target, key, value, recevier)
    trigger(target, key, value)
    return res
  }
}
```

在 `setter` 中，除了完成新值的修改，还有一个重要工作，就是去触发对应的依赖完成重新执行。

#### trigger

```ts
export function trigger(target, key, value) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    return
  }
  const dep = depsMap.get(key)
  triggerEffects(dep)
}
```

```ts
export function triggerEffects(dep) {
  const effects = [...dep]
  for (const effect of effects) {
    triggerEffect(effect)
  }
}
```

```ts
export function triggerEffect(effect) {
  effect.run()
}
```

在触发依赖的实现核心逻辑中，首先根据 `target` 在 `targetMap` 中查找对应的依赖合集。如果有的话，再根据 `key` 找到对应的 `depSet`，然后遍历执行所有的 `effect.run` 方法。

至此，触发依赖工作就全部完成了。

## 问题

1. Getter 的“懒代理”预埋 是什么意思？

> 在 mutableHandlers 的 get 实现里，如果访问的是对象嵌套（比如 proxy.user.name），Vue 3 是在 get 被触发时才递归调用 reactive 的。这和你刚才分析的“缓存机制”配合，保证了性能。

上面这段话如何理解？

2. 为什么 track 内部还要判断 if (activeEffect)？

在当前的测试代码中，activeEffect 肯定是存在的。但是在实际的复杂业务场景中，很多属性的访问可能就不是发生在 effect 中，比如代码中就是 `console.log(proxy.name)` 这一句呢？

- 如果没有这个判断：Vue 会尝试给这个普通的读取行为也去建表、存依赖，导致内存被无意义的空 Set 占满。
- 有了它：Vue 保证了只有在“副作用函数运行期间”的读取操作，才会被记录。

3. 隐藏的“双向链接”（反向收集）？

> 为什么要反向收集？ 就像我之前提到的，这是为了让 effect 知道自己被哪些属性“包养”了。当这个 effect 被销毁（stop）时，它可以快速找到这些 dep 并把自己从里面踢出来，而不需要遍历整个 targetMap。

上面这段话如何理解？

4. 为什么 triggerEffects 要做一次拷贝 [...dep]？

在源码中，这是一个非常重要的防死循环机制。

- 如果不拷贝：如果在执行 effect.run() 时，该函数内部又修改了同一个 key，那么它会再次触发 track 并把这个 effect 加回 dep。在一个正在遍历的 Set 中不断添加元素，会导致 for...of 永不停止。
- 拷贝后：我们遍历的是“触发瞬间”的快照，保证了更新的稳定性。

5. Scheduler（调度器）的伏笔

> 在 Vue 的组件更新（如 watchEffect）中，triggerEffect 往往不会直接跑 run，而是跑 effect.scheduler()。这就是为什么 Vue 能做到异步批量更新：它把所有待运行的 effect 塞进一个微任务队列（Job Queue），等同步代码跑完后，再统一执行一次渲染。

上面这段话如何理解？

6. targetMap -> depsMap -> dep “依赖图谱”的精确性

“这种三层嵌套结构（WeakMap > Map > Set）保证了 Vue 3 能够实现属性级别的精准更新。即使一个对象有 100 个属性，我修改其中一个，也只会触发依赖那一个属性的副作用函数，而不会误伤其他属性。”