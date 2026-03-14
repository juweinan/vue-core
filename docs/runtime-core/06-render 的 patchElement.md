# 从 render 到 patchElement 再到 diff 算法

## 1. render --- unmount or patch

首先在 render 中就是做了一个分流，分流执行的两个方法，也是后面 patch 的时候，递归首选的方法

- vnode = null，container._vnode 存在的话，就执行 unmount，否则什么都不处理
- vnode 存在，patch(container._vnode, vnode)

## 2. patch --- process which type & shapeFlag

这个方法还是做了一个分流

首先先来两个优化判断：

- 判断 n1 === n2，旧新 vnode 相等的话，说明没有变化，不需要处理
- n1 存在，但是 n1 的 key 或者 type 不等于 n2 的 key 或者 type，这种情况认为节点发生了根本的变化，直接卸载 n1，n2 当挂载处理

判断 n2.patchFlag 是否是标记了退出 diff 优化（也就是是否需要全量比较）
然后就是开始分流：主要是根据 type（优先） 以及 shapeFlag 判断应该做什么类型的处理

## 3. processElement（这里暂时讨论的是 ELEMENT 类型）--- mountElement or patchElement

这个方法还是个分流

- 不存在 oldVNode，执行 mountElement
- 存在 oldVNode，执行 patchElement

## 4. patchElement

1. 获取 el，el 就是 oldVNode 的 el，所有的更新也往这个 el 上更新
2. 子节点是动态的，从遍历 block 中的元素，挨个 patch
3. 子节点不是动态的，那就是没有优化标记，需要深度递归 patchChildren
4. patchProps
5. 异步执行 update 生命周期函数

## 5. patchChildren

其实还是分流：现根据 patchFlag 区分是不是开挂模式，开挂模式有分有没有 key，非开挂模式根据子节点类型相互匹配规则

1. 如果标记了 patchFlag，表示子节点可以进行快速比较
  - 如果子节点是包含 key 的，执行 patchKeyedChildren
  - 如果子节点不包含 key，执行 patchUnkeyedChildren（这个就是从头开始逐个 patch，直到有一方 patch 完了，剩下的就是新增或者删除）
2. 不是快速比较，子节点无非就三种格式：text、null、array
  - 新的包含文本：删除旧的（数组），旧的文本可以直接替换，不需要先删除再设置新的文本
  - 新的是 null 或者 array
    - 新旧都是 array，执行 patchKeyedChildren
    - 新的是 null，删除旧的（数组）
    - 旧的是 文本，清空文本
    - 旧的是 null，新的是 array，mountChild

## 6. patchKeyedChildren（准备 diff 算法）

1. 全部从头开始 patch，直到新旧 vnode 的 key 或者 type 不一致或者有一条线比较完了时才停下来（不一致代表发生了根本的变化）
2. 全部从尾开始 patch，停下来的条件跟上面一致
3. 如果新的 patch 完了，剩余的旧的全部 unmount
4. 如果旧的 patch 完了，剩余的新的全部 mount
5. 如果经历上面四步，新旧 children 还存在，那么就开始真正的进入到了 diff 大关

## 7. Diff

剩余的旧子节点：restOldCs
剩余的新子节点： restNewCs

#### 7.1 创建 keyToNewIndexMap（newIndex key => fullIndex)

存在 key 的新子节点在整个 newChildren 中的 index 映射
key1 => index1

#### 7.2 newIndexToOldIndexMap

restNewCs 对应的 oldChild 的位置，默认对应的 oldChildIndex 都是 0（后面 0 用于表示没找到）

#### 7.2 处理旧节点

遍历 restOldCs，每次循环完一个 oldChild 都会计数，如果处理完了的 oldChild 数量大于 newChild 数量，剩余的可以直接删除了

- 如果存在 key，上 keyToNewIndexMap 中查找相同 key 的 index（建立相同 key 的新旧 child 位置连接）
- 不存在 key，找 type 相同的（这个不能是之前已经被匹配过的），建立相同 type 的新旧 child 位置连接）

如果还是没找到在 restNewCs 中的位置，删除这个旧的节点
如果找到了，在 newIndexToOldIndexMap 中记录一下（因为新的节点位置就是 newIndexToOldIndexMap 的下标，
旧的位置需要加1，目的是为了区分 0。然后 patch 两个 vnode

这里还有两个参数，

一个是 maxNewIndexSoFar （到目前为止，找到的最大的 newIndex）
还有一个是否需要移动的标识 moved

这两个参数是配合使用的

因为遍历旧的节点，是按照从前到后的顺序便利的，所以每次的 oldIndex 一定是大于上一次的 oldIndex 的
那么如果每次 oldChild 找到的 newChild 的 index 也是大于上一次的 newIndex，那说明节点顺序是没发生变化的
因为新旧 vnode 都是再上一个 vnode 的后面

但是如果 newIndex < maxNewIndexSoFar，说明 newIndex 变小了，但是 oldIndex 却是在变大，说明节点发生了移动，这个时候就标记一下需要移动

到这个时候，对于 restOldCs 来说，需要 unmount 的和 patch 的都已经结束了
剩下的工作无非就是移动和新增子节点了（如果存在移动和需要新增的子节点）

#### 7.3 核心中的核心（最长递增子序列）

什么叫最长递增子序列呢？

就是在一个大的序列中，在不改变整个序列顺序的情况下，从头到尾，找出最长的一个，逐渐递增的序列，就叫最长递增子序列

然后再 vue 中，这个最长递增子序列存储的不是序列中的递增的数值，而是这些递增数值对应的下标。因为他是从 newIndexToOldIndexMap 中取出来的
序列中的索引代表着，这个位置的节点不需要动
目的就是让更少的节点移动

遍历 restNewCs（从后往前遍历，因为是 insertBefore，能保证后面的节点就是确定好位置的）

如果，当前子节点没找到对应的 oldChild，说明新增，执行 patch 挂载
如果当年前子节点的索引在子序列中存在，那么说明这个节点不需要动，然后子序列的 index--
如果不是上面的两种情况，说明需要移动了，则找到 oldChild 的 el，执行 insertBefore
这里因为 element 的特性，直接在新的位置插入一个 dom 中存在的 el，不需要提前删除，他会直接移动

至此，element 元素从 render 到 diff 的流程就理通了
