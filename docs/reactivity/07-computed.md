```html
<div id="app"></div>

<script>
  const { reactive, computed, effect } = Vue

  const son = reactive({
    firstName: 'wang',
    lastName: 'daxun'
  })

  const fullName = computed(() => {
    return son.firstName + son.lastName
  })

  effect(() => {
    document.querySelector('#app').innerText = fullName.value
  })

  setTimeout(() => {
    son.lastName = 'genji'
  })
</script>
```

逐行分析上面的代码...

reactive 这里不过多赘述，这里主要关注创建 target 的 getter/setter。

### computed 源码

下面执行 computed 方法，这里就进入到了本章的重点！！！

```ts
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  const onlyGetter = isFunction(getterOrOptions)
  if (onlyGetter) {
    getter = getterOrOptions
    setter = () => {}
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  const cRef = new ComputedRefImpl(getter, setter)

  return cRef
}
```

在 computed 方法的源码实现中：

- 首先判断 computed 自身接受的参数是对象还是函数，如果是函数，则默认创建一个空的 setter，否则的话，就存储对象中的 get/set。
- 创建一个 ComputedRefImpl 实例并返回。

### ComputedRefImpl 源码

```ts
export class ComputedRefImpl<T> {
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean,
    isSSR: boolean
  ) {
    this.effect = new ReactiveEffect(getter, () => {
      if (!this._dirty) {
        this._dirty = true
        triggerRefValue(this)
      }
    })
    this.effect.computed = this
  }
}
```

因为在 computed 中，只是实例化了 ComputedRefImpl，所以这里只看构造函数中的代码。

- 实例化了 ReactiveEffect，得到一个 effect，下面都称为 cRefEffect，并作为 cRef.effect（实例属性）
- getter 函数作为 cRefEffect 的 fn 实例属性
- 这里面还传递了一个 scheduler 调度器函数，函数中的具体实现暂时可以不看
- 给这个 cRefEffect 标记为是一个计算属性类型

```ts
// cRef.effect.fn 指向的方法是：
;() => {
  return son.firstName + son.lastName
}
```

这里有一个要注意的点，那就是 并没有执行 cRefEffect.run()，所以 activeEffect 还是空的。
至此，computed 执行结束。

```ts
effect(() => {
  document.querySelector('#app').innerText = fullName.value
})
```

执行业务代码 effect，在源码中也是创建一个 \_effect 实例（下面用 bizEffect 表示），执行 run 方法。这时候的 activeEffect 等于 bizEffect，执行 effect 中的 fn，开始访问计算属性 fullName.value。

关于 fullName.value 的实现，可以看 ComputedRefImpl 中的 get 方法。

```ts
export class ComputedRefImpl<T> {
  public dep?: Dep = undefined

  private _value!: T

  public _dirty = true

  get value() {
    const self = toRaw(this)
    trackRefValue(self)
    if (self._dirty || !self._cacheable) {
      self._dirty = false
      self._value = self.effect.run()!
    }
    return self._value
  }
}
```

首先执行 toRaw 拿到原生的计算属性，这步应该是跟 Ref 一样，防止被 reactive 嵌套。

开始收集依赖。这时的 activeEffect 是什么，是上面提到的 bizEffect。然后双向收集的过程是 cRef.dep 和 bizEffect 的之间收集。

因为在实例化的时候，\_dirty 默认是 true，所以进入判断条件，将 \_dirty 设置为 false。执行 cRef.effect.run()，这个时候 activeEffect 指向的是 cRefEffect，然后执行 cRefEffect.fn，也就是计算属性中的 getter 方法。

```ts
;() => {
  return son.firstName + son.lastName
}
```

这个时候，因为访问了 reactive 的属性，所以触发了 proxy.getter，然后 target.key 跟 cRefEffect 之间的相互依赖收集。最后将返回值存储在 cRef.\_value 属性上并返回。至此，业务代码中的 effect 执行完毕。

在执行业务 effect 的过程中，一共触发了两次依赖收集：

1. 在 \_effect.run() 时，完成了 bizEffect 和 cRef.dep 之间的相互收集
2. 在 self.effect.run() 时，完成了 cRefEffect 和 targetMap 的 key 之间的相互收集

关于 \_dirty 属性的解释：

可以理解为默认数据就是脏的，当第一次访问完了之后，得到 \_value，就认为数据不是脏的了。那么下次在访问的时候，发现数据是干净的，就直接从缓存中读取了，而无需重新计算。

```ts
setTimeout(() => {
  son.lastName = 'genji'
})
```

执行 proxy.setter，因为 proxy.key 是在 computed 中的 getter 访问的，所以这时候触发的依赖应该是 ComputedRefImpl 中构造函数创建的 effect，也就是 cRefEffect。

回看一下这个 effect 长什么样

```ts
this.effect = new ReactiveEffect(getter, () => {
  if (!this._dirty) {
    this._dirty = true
    triggerRefValue(this)
  }
})
this.effect.computed = this
```

有 fn、schduler、computed 这几个属性。那么就来看看 trigger 方法中是怎么执行的吧

```ts
export function triggerEffects(dep: Dep | ReactiveEffect[]) {
  const effects = isArray(dep) ? dep : [...dep]
  for (const effect of effects) {
    if (effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo)
    }
  }
  for (const effect of effects) {
    if (!effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo)
    }
  }
}
```

这里执行是有个优先级的，关于 computed 类型的 effect 要优先执行，然后再执行普通的 effect。

为什么要这么处理呢？

```ts
const count = ref(0)
const double = computed(() => count.value * 2)

effect(() => {
  console.log(count.value, double.value)
})

setTimeout(() => {
  count.value++
})
```

在上面的测试代码中，effect 同时依赖了 count.value，和 double.value。
当执行 count.value++ 的时候，count 收集起来的 effect 一共有两个：

1. double 内部的 effect => cRefEffect
2. 业务代码中的 effect => bizEffect

如果没有优先执行 computed 的 effect：
先执行了 bizEffect，那么这时候得到的 double.value 就是旧的值，随后才执行 cRefEffect。

有了双循环：
就能保证先触发计算属性的 effect，然后再触发业务 effect，这样就能保证都能拿到最新的值了。

所以回到正题，弄明白了为什么要先执行 computed 类型的 effect，继续看 triggerEffect

```ts
function triggerEffect(effect: ReactiveEffect) {
  if (effect !== activeEffect || effect.allowRecurse) {
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}
```

因为当前触发的是 cRefEffect 有 scheduler 属性，所以执行他

```ts
;() => {
  if (!this._dirty) {
    this._dirty = true
    triggerRefValue(this)
  }
}
```

因为此时的 _dirty 是 false，所以能进入判断条件，标记一下数据已经脏了（但是这里并没有计算新的数据哦），然后触发依赖。

这时触发的依赖又是什么呢？effect 存在于 cRef.dep 中，所以触发的是 bizEffect，这是一个普通 effect，执行 run 方法，其实这个时候已经回到了第一次执行业务代码 effect 的源码逻辑了。

activeEffect 又等于 bizEffect 了，然后执行 fn，开始访问计算属性的 getter。

首先开始收集依赖，是 cRef.dep 跟 bizEffect 之间的双向收集。继续执行，因为在 scheduler 中已经标记了数据脏了，需要重新计算，所以这里执行 self.effect.run()，然后 activeEffect 又等于 cRefEffect，执行 fn，也就是 computed 方法中传入的 get 方法。

这时候又开始访问 proxy.getter，完成 targetMap.key 跟 cRefEffect 之间的双向收集，并计算出新的计算属性结果，缓存、返回、标记数据是干净的（_dirty = false）。

然后 effect 执行完成，页面更新了。

至此整个流程已经结束了。