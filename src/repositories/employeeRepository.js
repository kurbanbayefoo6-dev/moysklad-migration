import { BaseRepository } from './baseRepository.js'

export class EmployeeRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/employee',
			...options,
		})
	}
}

export const employeeRepository = new EmployeeRepository()

export default employeeRepository
