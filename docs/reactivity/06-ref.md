## ref + effect 的应用

```html
<div id="app"></div>

<script>
  import { ref, effect } from 'Vue'

  const count = ref(0)

  effect(() => {
    document.querySelector('#app').innerText = `数量：${count.value}`
  })

  setTimeout(() => {
    count.value++
  }, 2000)
</script>
```

逐行分析上面的代码，并使用源码的角度去解读...

首先执行 `const count = ref(0)`，在源码中相当于执行了 `createRef` 方法，而这个方法也仅仅是实例化一个 `RefImpl` 对象。

看一下 `RefImple` 类的具体实现：

```ts
class RefImpl<T> {
  private _value: T
  private _rawValue: T

  public dep?: Dep = undefined
  public readonly __v_isRef = true

  constructor(public value: T) {
    this._rawValue = toRaw(value)
    this._value = toReactive(value)
  }

  get value() {
    trackRefValue(this)
    return this._value
  }

  set value(newVal) {
    newVal = toRaw(newVal)
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal
      this._value = toReactive(newVal)
      triggerRefValue(this)
    }
  }
}
```

在构造函数中，主要是做了两件事儿：

1. 初始化实例的 `_rawValue`，主要是存储传进来的原始对象
2. 初始化实例的 `_value`，并且这个值是传进来的数据转换成 `reactive` 类型的数据

这里跟 `reactive` 处理方式不同的是，`reactive` 只有在访问的时候才会转换，而 `ref` 在初始化的时候就转化了。

至此 `ref()` 执行完成。然后开始执行 `effect`

实例化 `_effect`，执行 `run`，赋值 `activeEffect`，执行 `this.fn()`，然后访问了 `count.value`。

在上面的 `RefImpl` 类中，定义了存取器，`getter` 和 `setter`，因为访问了 `count.value`，所以进入到 `getter` 中，执行 `trackRefValue`。

```ts
export function trackRefValue(ref: RefBase<any>) {
  if (shouldTrack && activeEffect) {
    ref = toRaw(ref)
    trackEffects(ref.dep || (ref.dep = createDep()))
  }
}
```

这是收集 `Ref` 类型数据依赖的方法，首先还是要判断是否能收集（防止隐式操作做无用收集）以及是否存在可收集的依赖，先将 `ref` 转化为原始数据，这一步是防止 `ref` 被 `reactive` 包装，然后拿到 `ref.dep` 去调用 `trackEffects` 收集依赖。

这里的收集相对于 `reactive` 要简单的很多。因为每个 `ref` 都是独立的，他只有一个 `.value` 属性，所以不需要建立很复杂的数据结构去维护依赖和 `ref` 之间的关系。

至此依赖收集完成。

然后执行 `setTimeout`，修改 `count.value`，这又会走到 `Ref` 的 `setter` 中。在 `setter` 中，修改构造函数初始化时维护的两个数据，然后调用 `triggerRefValue` 触发依赖。

```ts
export function triggerRefValue(ref: RefBase<any>, newVal?: any) {
  ref = toRaw(ref)
  if (ref.dep) {
    triggerEffects(ref.dep)
  }
}
```

因为上面提到了 `ref` 只有一个 `value` 属性，所以他对应的依赖 `dep` 就在自己的实例对象上，直接拿出来遍历里面的 `effect` 执行 `run` 方法即可。

至此，依赖触发结束，整个测试代码完成源码解释闭环。

#### ref 一个对象是是如何 track 和 trigger 的？

```ts
const data = ref({ count: 0 })

effect(() => {
  console.log(data.value.count)
})
```

- 第一层拦截 `Ref` 层：虽然访问的是完整的 `data.value.count`，但是还是会先访问 `data.value`，触发了 `RefImpl` 的 `get`，收集依赖到 `ref.dep` 上。
- 第二层拦截 `Proxy` 层，因为 `ref` 接收的是一个对象，所以在初始化的时候，会执行一次 `toReactive`，这时候 `.value` 就会进入 `proxy` 的 `getter`，然后收集依赖。

为什么要这么做呢？

- 第一层拦截的目的是：当执行 `data.value = {}` 时，只触发 `ref.set` 中的 `trigger`。
- 第二层拦截的目的是：当执行 `data.value.count = 3` 时，只触发 `proxy.set` 中的 `trigger`。

如果只拦截第二层，那么直接修改 `data.value` 就不会响应式执行 `effect` 了。

这样就做到了，收集的时候是一个链式穿透的过程，但是触发的时候，又能精准定位到应该执行的依赖。

```ts
const data = reactive({
  parent: {
    name: 'father',
    child: {
      name: 'child'
    }
  }
})
```

同理，在 `reactive` 中，访问 `data.parent.child.name` 时，在 `track` 中会逐层收集依赖，也就是说 `date.parent` `data.parent.child data.parent.child.name` 每个层级的 `getter` 都会 `track` 一次。

但是在修改的时候，只有修改了对应层级属性值的 `dep` 才会被拿出来触发里面的 `effect`。也就是说，执行 `data.parent = {}` 的时候，只会触发 `parent` 层级的 `trigger`，不会触发其他层级的 `trigger`。

