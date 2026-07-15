import { expenseItemRepository } from '../repositories/expenseItemRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class ExpenseItemResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Expense Item',
			repository: options.repository || expenseItemRepository,
			client: options.client || 'new',
			strategies: [
				{ name: 'name', field: 'name', method: 'findByName' },
				{
					name: 'externalCode',
					field: 'externalCode',
					method: 'findByExternalCode',
				},
			],
		})
	}
}

export const expenseItemResolver = new ExpenseItemResolver()

export default expenseItemResolver
