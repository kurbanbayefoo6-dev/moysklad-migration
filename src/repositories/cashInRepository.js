import { BaseRepository } from './baseRepository.js'

const CASH_IN_EXPAND = [
	'operations',
	'organization',
	'organizationAccount',
	'agent',
	'agentAccount',
	'contract',
	'project',
	'state',
	'rate.currency',
	'attributes',
].join(',')

export class CashInRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/cashin',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: CASH_IN_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const cashInRepository = new CashInRepository()

export default cashInRepository
