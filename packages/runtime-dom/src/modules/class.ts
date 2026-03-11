import { ElementWithTransition } from '../components/Transition'

// compiler should normalize class + :class bindings on the same element
// into a single binding ['staticClass', dynamic]
/**
 * 如果 newClass 不存在，直接清空 class 属性
 * 存在的话，直接用 newClass 全部替换
 * @param el 
 * @param value 
 * @param isSVG 
 */
export function patchClass(el: Element, value: string | null, isSVG: boolean) {
  // directly setting className should be faster than setAttribute in theory
  // if this is an element during a transition, take the temporary transition
  // classes into account.
  const transitionClasses = (el as ElementWithTransition)._vtc
  if (transitionClasses) {
    value = (
      value ? [value, ...transitionClasses] : [...transitionClasses]
    ).join(' ')
  }
  if (value == null) {
    el.removeAttribute('class')
  } else if (isSVG) {
    el.setAttribute('class', value)
  } else {
    el.className = value
  }
}
