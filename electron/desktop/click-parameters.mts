export function validateDesktopClick(args) {
  if (args.mouse_button !== undefined && !['left', 'right', 'middle'].includes(args.mouse_button))
    throw new Error('鼠标按键必须是 left、right 或 middle。');
  if (args.click_count !== undefined && (!Number.isInteger(args.click_count) || args.click_count < 1 || args.click_count > 3))
    throw new Error('点击次数必须是 1、2 或 3。');
  if (args.element_index && (args.x !== undefined || args.y !== undefined))
    throw new Error('点击只能选择控件编号或截图坐标之一。');
}
