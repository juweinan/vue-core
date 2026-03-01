## ReactiveFlags.RAW 和 toRaw()

`ReactiveFlags.RAW` 其实就是 `__v_raw` 属性

这是一个内部标识符，如果访问的对象上有 `__v_raw` 属性，则表示这是一个被 `reactive` 或者 `readonly` 包装过的**响应式对象**。通常这个属性指向的就是被代理的原始对象。

可以通过 `proxy.__v_raw` 访问原始对象，但是这是一个内部属性，`Vue3` 中提供了一个 `toRaw()` 方法，可以获取原始对象。

```js
const raw = { count: 0 }
const proxy = reactive(raw)

console.log(proxy.__v_raw === raw) // true
console.log(toRaw(proxy) === raw) // true
```

## ReactiveFlags.SKIP 和 markRaw()

`ReactiveFlags.SKIP` 其实就是 `__v_skip` 属性

这是一个内部标识符，如果访问的对象上有 `__v_skip` 属性，则表示这是一个**跳过代理的对象**。通常这个属性的值为 `true`，表示这个对象永远不会被转变为响应式代理对象。

#### 这也是 `markRaw()` 方法的底层实现。

当调用官方提供的 `markRaw(obj)` 方法时，实际上就是给这个原始对象添加了 `__v_skip` 属性，值为 `true`。

```js
import { markRaw, isReactive, reactive } from 'vue'

const raw = { count: 0 }
markRaw(raw)

console.log(raw.__v_skip) // true
console.log(isReactive(reactive(raw))) // false
```

## 注释解释

`/*#__PURE__*/` 核心含义是表示这个函数是纯函数，不会产生副作用。

添加这个标记的目的不是为了删掉“正在使用的代码”，而是为了在“没人用这整个功能”时，能把相关代码删得一干二净。
