import { BaseRepository } from './baseRepository.js'

export class ExpenseItemRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/expenseitem',
			...options,
		})
	}
}

export const expenseItemRepository = new ExpenseItemRepository()

export default expenseItemRepository
