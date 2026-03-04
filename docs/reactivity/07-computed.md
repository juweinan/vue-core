关于 computed 的源码阅读，只能说读懂了一半，但是还有个很重要的问题没有读懂

首先，关于 computed 方法，源码中使用了函数重载的方式，对于接受的参数做一下兼容

- 直接收一个 getter 方法
- 接受一个可写入的对象选项，选项中要有 get 和 set 方法

在 computed 的方法内部，首先判断参数是否是一个函数类型

- 如果是函数，那么就直接当作 getter 方法实用，然后创建一个空的，执行没有任何意义的方法作为 setter
- 如果不是函数，那么就把 get 和 set 分别作为 getter 和 setter 实用

创建一个 ComputedRefImpl 实例，将 getter 和 setter 传进去

最后返回这个实例对象，至此 computed 方法实现完毕，这里没有什么难点

接下来看 ComputedRefImpl 构造函数

在构造函数中，直接将 getter 作为 ReactiveEffect 中的 fn 参数，创建一个 effect 实例，并放到自身的实例对象属性上，同时还传递了第二个参数，是一个方法，这是一个 scheduler 方法，用于判断在什么时候调用的

然后将 this 绑定到 effect 实例对象上，不考虑服务器渲染的话，active 肯定是 true

这个时候构造函数已经执行完毕了，但是有个注意的点，因为 effect 只完成了实例化，没有调用 run 方法，所以这是 this.effect 并不等于 activeEffect
还有这个参数 scheduler 也并没有被执行。

下面，我们假设存在一下业务代码

```js
effect(() => {
  console.log(computedRef.value)
})
```

因为执行 effect 方法，本身就会创建 \_effect 实例，并执行 run，所以这里的 activeEffect 指向的是业务代码 effect 创建的 \_effect 实例，而非构造函数中的 this.effect，

然后执行 computedRef.value，就会走到构造函数中的 get value 中，开始将 computedRefImpl 实例对象中的 dep 和 activeEffect 双向收集（原因之前提过很多次，这里不赘述）

依赖收集完成之后，因为 \_dirty 默认就是 true，所以能执行到判断条件里，然后将 \_dirty 置为 false，
执行 this.effect.run()，这时候 run 中的 this.parent 在我的学习中第一次用到了，我猜测这个应该是用于存储业务中 effect 方法 activeEffect，
因为执行了 this.effect.run，所以这时的 activeEffect 指向的就是 this.effect 了，然后，因为执行了并返回 fn

这时候的 fn 是什么，其实是 computed 中的 getter

```js
const user = reactive({
  firstName: 'wang',
  lastName: 'genji'
})

const computedRef = computed(() => {
  return user.firstName + user.lastName
})
```

这个时候执行 getter 就是跟 reactive 相关的依赖收集了，只不过 reactive 收集的依赖其实是 computedRef 中的 this.effect。
同样的 this.effect 也会收集这两个属性

执行完了 fn，返回值添加到 self.\_value 上缓存起来。至此 effect 执行结束

这里顺便提一下，计算属性中的 set 方法，其实就是执行了传入的 set 方法，他不影响计算属性自身中的任何功能
set 方法中写了什么，都是完全独立于 computed 的另外一套 getter/setter，track/trigger 等

```ts
setTimeout(() => {
  user.lastName = 'daxun'
})
```

这个时候，触发了 proxy 中的 setter，然后开始 trigger，这时候 trigger 的 effect 是什么，其实是 computedRef 中的 this.effect，执行 run 方法等于执行了 computed 中的 getter，也就是 user.firstName + user.lastName

不过这个时候 trigger 流程中的 triggerEffects 会进入到 if (effect.computed) 的逻辑里，而且这个 effect.computed 就是计算属性实例，但是这里的源码好想写的比较冗余

```ts
export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
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

因为不管是不是存在 computed 属性，都是进入到了 triggerEffect 方法，不过在这个方法中，别有洞天

```ts
function triggerEffect(
  effect: ReactiveEffect,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  if (effect !== activeEffect || effect.allowRecurse) {
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}
```

因为 computed 在实例化的时候，创建的 effect 中传入了 scheduler，所以就开始执行 scheduler

```ts
;() => {
  if (!this._dirty) {
    this._dirty = true
    triggerRefValue(this)
  }
}
```

这个时候，this.\_dirty = false，因为在第一次访问这个属性的时候，就把它设置为 false 了，然后再设置为 true，开始触发依赖

看到这里，就知道计算属性到底是怎么缓存的了，他的实现思路就是，在第一次访问这个计算属性的时候，他通过开关 \_dirty 用于判断是否之前访问过了，
没访问过，那么就执行 get 拿到结果缓存，并标记结果已经访问过了，然后后面在访问这个属性的时候（假如中间没有修改过），发现之前计算过了，就直接那前面的结果返回
从而达到了缓存的目的

然后修改了一次，进入到 scheduler，标记为没访问过（或者说这个缓存失效了更合理），然后开始触发依赖。

这时候又要问了，触发的是什么依赖呢，讲着讲着我自己也懵了，我理一下。。。

这个时候触发的是 computed 实例的 effect，实例的 dep 中收集的是哪个 effect 呢，很明显是业务代码中的 effect，因为是这个函数中访问了计算属性
（这里忽然想明白，也是想到了，依赖的属性和副作用函数的关系，就是函数中用到了谁，那就跟谁关联）

然后触发 trigger 就不会进入 scheduler 条件了，而是直接执行 run 方法，打印 计算属性的结果

至此整个流程完成完整闭环

在整理的过程中，突然理通了我开头提到的一些疑惑，不过有个问题，就是 effect 中的 this.parent 好想并没有在这里使用到。
