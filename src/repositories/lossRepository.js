import { BaseRepository } from './baseRepository.js'

const LOSS_EXPAND = [
	'organization',
	'store',
	'positions.assortment',
	'state',
	'project',
	'owner',
	'group',
].join(',')

export class LossRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/loss',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: LOSS_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const lossRepository = new LossRepository()

export default lossRepository
