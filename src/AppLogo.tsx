import { useResolvedTheme } from "./appearance/controller";

const lightLogo = new URL("../build/dyworker-light.svg", import.meta.url).href;
const darkLogo = new URL("../build/dyworker.svg", import.meta.url).href;

export function AppLogo() {
  const theme = useResolvedTheme();
  return <img className="app-logo" src={theme === "dark" ? darkLogo : lightLogo}
    width={24} height={24} alt="" aria-hidden="true" draggable={false} />;
}
