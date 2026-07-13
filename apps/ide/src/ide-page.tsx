import { AppStageShell } from '@tinytinkerer/app-shell'
import { IdeStage } from '@tinytinkerer/ide'
import { IdeChatLoading } from './app/loading-screen'

const IdePage = (): React.JSX.Element => (
  <AppStageShell
    initialChatMode="sidebar"
    chat={{
      storageKey: 'tinytinkerer:ide-layout:v1',
      LoadingComponent: IdeChatLoading,
      inspectorPanelSupported: true
    }}
  >
    <IdeStage />
  </AppStageShell>
)

export default IdePage
