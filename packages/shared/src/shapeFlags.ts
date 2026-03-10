/**
 * 为什么使用位运算？
 * 
 * 为了实现极速的复合类型判断。
 * 正常的 if (a === 'A' || b === 'B') 是比较慢的字符串比较。
 * 在 patch 阶段，判断一个节点是否是 “组件” 只需要一行位运算。
 * 
 * 结论就是：用二进制位来存储状态，占空间极小（一个数字存所有状态），运算速度极快（CPU 指令级）。
 */

export const enum ShapeFlags {
  /**
   * 元素节点
   * 二进制（00000001）
   */
  ELEMENT = 1,
  /**
   * 函数式组件
   * 二进制（00000010）
   */
  FUNCTIONAL_COMPONENT = 1 << 1,
  /**
   * 状态组件
   * 二进制（00000100）
   */
  STATEFUL_COMPONENT = 1 << 2,
  /**
   * 纯文本
   * 二进制（00001000）
   */
  TEXT_CHILDREN = 1 << 3,
  /**
   * 数组
   * 二进制（00010000）
   */
  ARRAY_CHILDREN = 1 << 4,
  /**
   * 插槽
   * 二进制（00100000）
   */
  SLOTS_CHILDREN = 1 << 5,
  TELEPORT = 1 << 6,
  /**
   * 延迟加载组件
   * 二进制（01000000）
   */
  SUSPENSE = 1 << 7,
  /**
   * 组件需要被缓存
   * 二进制（10000000）
   */
  COMPONENT_SHOULD_KEEP_ALIVE = 1 << 8,
  /**
   * 组件已经被缓存
   * 二进制（00000001 00000000）
   */
  COMPONENT_KEPT_ALIVE = 1 << 9,
  /**
   * 组件：函数式组件或者状态组件
   */
  COMPONENT = ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.FUNCTIONAL_COMPONENT
}
