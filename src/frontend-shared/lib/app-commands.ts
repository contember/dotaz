import { registerConnectionCommands } from './commands/connection-commands'
import { registerGridCommands } from './commands/grid-commands'
import { registerNavigationCommands } from './commands/navigation-commands'
import { registerQueryCommands } from './commands/query-commands'
import { registerViewCommands } from './commands/view-commands'

export interface AppCommandActions {
	toggleModal: (type: string) => void
	setModal: (modal: { type: string; [key: string]: unknown } | null) => void
	openAddConnectionDialog: () => void
	toggleCollapse: () => void
	sidebarCollapsed: () => boolean
}

export function registerAppCommands(actions: AppCommandActions): void {
	registerNavigationCommands(actions)
	registerQueryCommands(actions)
	registerGridCommands(actions)
	registerConnectionCommands(actions)
	registerViewCommands(actions)
}
