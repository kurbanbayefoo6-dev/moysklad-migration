import { BaseRepository } from './baseRepository.js'

const CASH_OUT_EXPAND = [
	'operations',
	'organization',
	'organizationAccount',
	'agent',
	'agentAccount',
	'contract',
	'expenseItem',
	'project',
	'state',
	'rate.currency',
	'attributes',
].join(',')

export class CashOutRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/cashout',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: CASH_OUT_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const cashOutRepository = new CashOutRepository()

export default cashOutRepository
