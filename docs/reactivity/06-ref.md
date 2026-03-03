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

逐行分析上面的代码...

首先执行 `ref(0)`，在源码中相当于执行了 createRef 方法，而这个方法也仅仅是实例化一个 RefImpl 对象。

在这个 RefImple 类中主要存在以下内容：

```ts
class RefImpl<T> {
  public deps: Dep[] = []
  readonly __v_isRef = true

  constructor(public value: T) {
    this.__rawValue = toRaw(value)
    this._value = toReactive(value)
  }

  get value() {
    trackRefValue(this)
    return this._value
  }

  set value(newVal) {
    newVal = toRaw(newVal)
    if (hasChanged(newVal, this.__rawValue)) {
      this.__rawValue = newVal
      this._value = toReactive(newVal)
      triggerRefValue(this)
    }
  }
}
```

可以看到，构造函数中主要是存储 ref 接收的原始数据，以及响应式处理后的数据

然后还有一个 get 和 set

所以访问 ref 的时候要通过 value 去拿到响应式数据，因此也就出现了 ref.value 的用法。同样的修改也是 ref.value = newVal

在 get 和 set 是源码实现中，分别手动执行了收集和触发依赖，这里先不着急，至此通过 ref 创建响应式对象的工作已经完成了

执行 effect 方法

创建 _effect 实例，执行 run 方法，初始化 activeEffect，执行 fn

然后在 fn 中访问了 ref.value，走到了 ref 实例的 get 方法，开始收集依赖，这里的收集也是双向的。只不过 reactive 中依赖是一个三层的数据，ref 只需要一个 dep 属性，存储使用他的 effect 就可以了

然后执行 setTimeout 修改 ref，走到了 set ，除了修改值以外，就是手动触发依赖，这里触发依赖相对于 reactive 也是比较简单的，直接拿到 ref 实例的 deps 属性，然后遍历 effect 执行 run 即可。

至此 ref 的测试代码在源码中的执行流程就结束了

这里我有个想法，就是 ref 实例中的 deps 其实只收集了 ref.value 的访问，如果说 ref({ count: 1 })，访问的是 ref.value.count，那么 dep 其实是收集到了 targetMap 中 target 对象中的 key 的 dep 中了，也就是那个三层结构，是不是这样的

这块是我目前能理解到了，不知道是不是还存在什么细节，或者对于 ref 的特殊处理点我没有注意到的地方，希望可以帮我提出来，或者你认为 ref 中独特于 reactive 的依赖收集有哪些，我之前学到的 effect 中没掌握的点在 ref 中有体现也可以提出来

其实在 triggerRefValue 和 trackRefValue 中，有一个 toRaw(ref) 的操作，但是 ref 实例并没有 __v_raw 属性，所以这个步骤是不是多余的呢