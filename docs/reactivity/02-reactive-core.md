## 核心代码

#### reactive

`PATH: /packages/reactivity/src/reactive.ts`

```ts
export function reactive(target: object) {
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}
```

#### createReactiveObject

```ts
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // 1. target 必须是一个有意义的对象，如果不是对象，直接返回 target
  // 2. target 是否是一个代理对象（拥有 __v_raw 属性），如果是，则直接返回 target
  // 特例：
  // 当 target 拥有 __v_raw 并且拥有 __v_isReactive 属性，并且当次调用方法传递的 isReadonly 为 true 时，不需要直接返回 target
  // 因为这表示，当前执行的代码是 readonly(reactive(raw))，意味着需要将一个非只读的代理对象变为只读的代理对象
  // 3. 从缓存读取是否已经创建过 target 的代理对象，如果有，直接返回代理对象即可（防止多次创建代理对象）
  // 4. 判断 target 是否是跳过的或者不可扩展的，如果是，也直接返回 target
  // 5. 调用 new Proxy() 创建代理对象
  // 6. 缓存代理对象，并且返回代理对象
}
```

#### mutableHandlers

当被代理对象是 普通对象或者是普通数组时 创建代理对象的 handler 使用的是 mutableHandlers

`PATH: /packages/reactivity/src/baseHandlers.ts`

```ts
export const mutableHandlers: ProxyHandler<object> = {
  get, // createGetter() 返回值
  set, // createSetter() 返回值
  deleteProperty,
  has,
  ownKeys
}
```

#### createGetter

`PATH: /packages/reactivity/src/baseHandlers.ts`

```ts
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    // 1. 访问特殊属性返回值
    // 2. 判断被代理对象是否是数组
    // 3. 如果说不是只读的，并且被代理对象是数组，访问的还是 Vue 中重写过的数组方法
    // 包括 'includes', 'indexOf', 'lastIndexOf', 'push', 'pop', 'shift', 'unshift', 'splice'
    // 则执行 Reflect.get(arrayInstrumentations, key, receiver) 代码
    // 重写的数组方法中，会触发 track 和 pauseTracking 以及 resetTracking 这三个重要的方法
    // 4. 正常读取对象的属性值
    // 5. 如果不是只读，那么调用 track（这里应该是收集依赖）
    // 6. 如果属性值是 ref 类型，
    // 被代理对象是数组，并且通过下标数字访问的数组属性，直接返回结果，如果不是对象访问，直接结构 ref.value 并返回
    // 7. 如果返回值是对象，用 reactive 或者 readonly 包装返回
  }
}
```

#### createSetter

`PATH: /packages/reactivity/src/baseHandlers.ts`

###### 第一段代码

```ts
let oldValue = (target as any)[key]
if (
  isReadonly(oldValue) && // 1. 旧值是只读的
  isRef(oldValue) && // 2. 旧值是一个 Ref
  !isRef(value) // 3. 新值不是 Ref
) {
  return false
}
```

理解这段代码的前提是：

- 在 `proxy` 的 `handler` 中，`setter` 返回 `false` 代表的是数据更新失败，返回 `true` 代表的是数据更新成功
- 在 `Vue` 的 `reactive` 对象中，如果把一个 `ref` 赋值给某个属性，`Vue` 会自动拆解这个 `ref`，让你直接通过 `obj.key` 访问到 `ref.value`

```js
const countRef = ref(0)
const proxy = reactive({
  count: countRef
})
console.log(proxy.count) // 0，无需使用 proxy.count.value
```

> 🙋 为什么要返回 `false` 呢？

在 `Vue` 中，`reactive` 对象对 `ref` 属性的修改有一条默认的规则：

**如果给一个 “已经是 ref” 的属性赋一个 “普通值”，Vue 会自动把这个新值添加到 “旧 ref” 的 .value 属性上**

所以关键点冲突就已经浮现了：

- `reactiveObj.someRefKey = commonObj` 就等同于 `oldValue.value = commonObj`
- 又因为 `oldValue` 是 `readonly`，那么修改 `.value` 就是错误的，因此返回 `false`

如果就想要修改掉这个 `oldValue`，那么新的值应该也是一个 `ref` 对象

###### 第二段代码

```ts
if (target === toRaw(receiver)) {
  if (!hadKey) {
    trigger(target, TriggerOpTypes.ADD, key, value)
  } else if (hasChanged(value, oldValue)) {
    trigger(target, TriggerOpTypes.SET, key, value, oldValue)
  }
}
```

直觉上：`receiver` 对应的就是 `proxy` 代理对象，所以 `toRaw(proxy)` 得到的结果就一定是 `target`，那么这个判断条件岂不是永远都成立？
但是，在涉及到继承的场景下，这个条件还真的不一定成立

所以，核心结论就是：**这个判断条件就是为了解决“原型链继承”的**

```js
import { reactive, toRaw } from 'vue'

// 创建一个父级的响应式对象
const parentRaw = { name: '父亲' }
const parentProxy = reactive(parentRaw)

// 创建一个子级的普通对象
const childRaw = { age: 18 }

// 也就是将 childRaw 的原型指向 parentRaw
Object.setPrototypeOf(childRaw, parentRaw)

// 这时，给 child 添加一个新的属性
childRaw.name = '儿子'
```

> 🙋 上面的代码发生了什么？？？

1. 由于 `childRaw` 自身是没有 `name` 属性的，所以会通过原型链向上查找
2. 在原型链中，找到了 `parentProxy`，于是就触发了 `setter`
3. 此时 `setter` 拦截器中:
   - `target` 对应的是 `parentRaw`（因为对应的是被代理对象）
   - `receiver` 对应的是 `childRaw`（因为是对 `childRaw` 进行的操作，`receiver` 代表的是最初触发操作的对象）
   - 这时候 `toRaw(receiver)` 得到的结果就是 `childRaw`
   - 所以 `target === toRaw(receiver)` 条件是 `false`，就不成立了

> 🙋 如果不加这个条件会发生什么？？？

不加这个条件，会让 `Vue` 觉得 `parentProxy` 数据发生了变化，就会触发对应属性的页面更新操作，但是其实只在 `childRaw` 这个普通对象自身添加了属性，白白浪费了一次页面更新操作。

而如果 `childRaw` 也是响应式对象，那么页面一共会触发两次更新操作！

所以这部分理解的重点在于，**`receiver` 指向的始终是最初触发操作的对象!!!**

在 Vue3 的设计哲学里：

- `target` 代表的就是被代理对象
- `receiver` 代表的就是最初发起操作的对象，也就是动作发生的起点

**只有动作起点就是被拦截对象时，`Vue` 才会认为这是一次有效的响应式更新！！！**
