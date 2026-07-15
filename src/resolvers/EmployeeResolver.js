import { employeeRepository } from '../repositories/employeeRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class EmployeeResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Employee',
			repository: options.repository || employeeRepository,
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

export const employeeResolver = new EmployeeResolver()

export default employeeResolver
