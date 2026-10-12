/**
 * 「插件」统一图标。
 *
 * 图形由用户指定：环形箭头包着一块拼图（16 格填充型），与 lucide 图标库自带的拼图不同，
 * 因此单独固定在应用内这一份 SVG，颜色统一走 currentColor，跟随主题和各处文字颜色。
 * 侧栏「插件」入口、设置里的「插件」项，以及插件页的图标位都用它。
 */
export function PluginIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M1 8a7 7 0 1 1 2.898 5.673c-.167-.121-.216-.406-.002-.62l1.8-1.8a3.5 3.5 0 0 0 4.572-.328l1.414-1.415a.5.5 0 0 0 0-.707l-.707-.707l1.559-1.563a.5.5 0 1 0-.708-.706l-1.559 1.562l-1.414-1.414l1.56-1.562a.5.5 0 1 0-.707-.706l-1.56 1.56l-.707-.706a.5.5 0 0 0-.707 0L5.318 5.975a3.5 3.5 0 0 0-.328 4.571l-1.8 1.8c-.58.58-.62 1.6.121 2.137A8 8 0 1 0 0 8a.5.5 0 0 0 1 0"
      />
    </svg>
  );
}
