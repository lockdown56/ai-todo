# Tauri 桌面与 Android 共用项目实施计划

## 目标与默认决策

- 保留现有 `desktop/` 项目，同时构建 Windows、Linux 和 Android。
- React 业务逻辑、API、认证、缓存和组件共享。
- 根据视口宽度选择布局：
  - `< 900px`：手机单栏布局。
  - `>= 900px`：现有桌面或平板布局。
- Android 首版仅支持在线核心功能，不做离线同步、通知和小组件。
- 首版生成 APK 侧载测试，Google Play 和 AAB 发布后置。

## 1. 前端结构重构

先拆分当前体积较大的 `desktop/src/App.tsx`，保持行为不变：

```text
src/
  app/
    AppRoutes.tsx
    SessionGate.tsx
  layouts/
    DesktopShell.tsx
    MobileShell.tsx
  features/tasks/
    useTaskWorkspace.ts
    TaskList.tsx
    TaskDetail.tsx
  features/navigation/
    DesktopSidebar.tsx
    MobileBottomNav.tsx
    MobileMorePage.tsx
  features/account/
    LoginPage.tsx
    ProfilePage.tsx
    SettingsPage.tsx
```

- `useTaskWorkspace` 统一管理任务查询、搜索、排序、增删改、选中任务和缓存更新。
- 桌面与手机布局只负责展示和导航，不复制请求逻辑。
- 现有 API 路径、React Query key 和认证存储格式保持兼容。
- `App.tsx` 最终只保留路由、认证门禁和布局选择。

## 2. 手机信息架构

新增受保护路由 `/more`，保留现有路由：

```text
/view/:view
/list/:listId
/profile
/settings
/more
```

手机底部导航固定为四项：

- 收集箱
- 今天
- 全部
- 更多

“更多”页面包含：

- 已完成
- 回收站
- 自定义清单
- 新建和管理清单
- 个人中心
- 设置

任务详情继续使用现有 `?task=<id>`，不引入第二套详情路由：

- 桌面端显示右侧详情栏。
- 手机端显示全屏详情页。
- Android 返回键或浏览器后退关闭详情并回到原任务列表。

## 3. 手机交互设计

- 顶部栏显示当前视图标题、搜索和排序入口。
- 快速添加栏固定在底部导航上方，键盘弹出时保持可见。
- 任务点击进入全屏详情，完成按钮保留在列表行。
- 删除、恢复、优先级等操作通过显式菜单提供，不依赖右键或悬停。
- 日期选择、清单选择和确认框在手机上改为全宽底部弹层。
- 所有主要触控区域最小为 `44x44px`。
- 支持安全区域：
  - `env(safe-area-inset-top)`
  - `env(safe-area-inset-bottom)`
  - `viewport-fit=cover`
- 页面高度使用 `100dvh`，处理 Android 地址栏和软键盘变化。
- 桌面快捷键逻辑仅在桌面布局启用。

## 4. 响应式样式

拆分现有 `desktop/src/styles.css`：

```text
styles/
  tokens.css
  common.css
  desktop.css
  mobile.css
```

手机布局不再继承以下桌面约束：

- `minmax(420px, 1fr)`
- 固定侧栏宽度
- 固定详情面板宽度
- 三栏 Grid

横屏手机仍使用手机布局；Android 平板达到 `900px` 后自动使用桌面布局。

## 5. Tauri Android 工程

### 环境准备

- Android Studio
- Android SDK、Build Tools 和 Platform Tools
- Android NDK
- Java 17
- Android Rust targets

### 初始化

```bash
npm --prefix desktop run tauri android init
```

在 `desktop/package.json` 增加：

```json
{
  "android:init": "tauri android init",
  "android:dev": "tauri android dev",
  "android:apk": "tauri android build -- --apk",
  "android:aab": "tauri android build -- --aab"
}
```

- 提交生成的 `desktop/src-tauri/gen/android` 工程。
- 保持当前 `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 入口。
- 首版最低支持 Android 7，使用 Tauri 默认 `minSdkVersion 24`。
- 保持当前应用标识用于内部 APK；上架前再确定永久包名和签名。
- 确认 Android Manifest 包含网络权限，不申请通知、存储或定位权限。

## 6. 网络与安全

- Android 正式版本只连接 HTTPS API。
- 生产服务器使用 Nginx 或 Caddy 暴露 `443`，API 的 `8000` 端口恢复为仅本机监听。
- CORS 保留 Tauri 来源：
  - `tauri://localhost`
  - `http://tauri.localhost`
  - `https://tauri.localhost`
- CSP 允许配置的 HTTPS API。
- 开发真机可使用 HTTPS 测试服务器，或通过 ADB 转发本机端口：

```bash
adb reverse tcp:8000 tcp:8000
```

- 首版继续使用现有 `localStorage` 保存登录令牌。
- 迁移 Android Keystore 或 Stronghold 单独立项。

## 7. 测试计划

### 自动化测试

- `390px`：手机底部导航、更多页、快速添加和全屏详情。
- `899px`：仍为手机布局。
- `900px`：切换为桌面或平板布局。
- Android 返回历史关闭任务详情。
- 软键盘打开时快速添加和保存按钮可见。
- 登录、过期自动退出、主动退出和 API 地址修改。
- 现有桌面端测试全部保持通过。

### 设备验收

- Android 模拟器和至少一台真机。
- 竖屏、横屏和平板宽度。
- 冷启动、恢复后台、弱网和断网提示。
- 中文输入法、日期选择、滚动和返回键。
- APK 安装、升级安装及登录状态保留。

### 验证命令

```bash
npm --prefix desktop test -- --run
npm --prefix desktop run build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
npm --prefix desktop run android:apk
```

## 实施顺序

1. 无行为变更地拆分共享业务组件。
2. 增加布局检测和 `MobileShell`。
3. 实现底部导航、更多页和全屏任务详情。
4. 完成触控、软键盘和安全区域适配。
5. 初始化 Tauri Android 工程。
6. 真机联调 HTTPS API。
7. 完成自动化测试和 APK 验收。
8. 后续独立实现通知、离线同步、签名和应用商店发布。

## 参考资料

- [Tauri Android 环境要求](https://v2.tauri.app/start/prerequisites/)
- [Google Play 与 APK/AAB 构建](https://v2.tauri.app/distribute/google-play/)
