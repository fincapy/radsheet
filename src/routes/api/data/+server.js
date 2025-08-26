/**
 * Streaming data generator (NDJSON) for large datasets.
 * Query params:
 *  - rows: number of rows (default 50000)
 *  - cols: number of columns (default 50)
 */

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
	const rows = Number(url.searchParams.get('rows') || 1_000_000);
	const cols = Number(url.searchParams.get('cols') || 50);

	const keys = [
		'ID',
		'Name',
		'Email',
		'Phone',
		'Department',
		'Position',
		'Salary',
		'HireDate',
		'Manager',
		'Location',
		'Status',
		'Skills',
		'Experience',
		'Education',
		'Certifications',
		'Projects',
		'Performance',
		'Reviews',
		'Benefits',
		'Vacation',
		'SickDays',
		'Training',
		'Goals',
		'Notes',
		'LastUpdated',
		'CreatedBy',
		'ModifiedBy',
		'Version',
		'Address',
		'City',
		'State',
		'ZipCode',
		'Country',
		'BirthDate',
		'Gender',
		'MaritalStatus',
		'Dependents',
		'EmergencyContact',
		'EmergencyPhone',
		'BankAccount',
		'RoutingNumber',
		'TaxID',
		'SSN',
		'PassportNumber',
		'DriverLicense',
		'InsuranceProvider',
		'PolicyNumber',
		'RetirementPlan',
		'StockOptions'
	].slice(0, Math.max(1, cols));

	const encoder = new TextEncoder();

	// Common values for testing string interning
	const commonDepartments = [
		'Engineering',
		'Sales',
		'Marketing',
		'HR',
		'Finance',
		'Operations',
		'Support',
		'Product'
	];
	const commonPositions = [
		'Manager',
		'Developer',
		'Analyst',
		'Coordinator',
		'Specialist',
		'Director',
		'Lead',
		'Associate'
	];
	const commonStatuses = ['Active', 'Inactive', 'Pending', 'Terminated', 'On Leave'];
	const commonLocations = [
		'New York',
		'San Francisco',
		'London',
		'Tokyo',
		'Berlin',
		'Sydney',
		'Toronto',
		'Paris'
	];
	const commonSkills = [
		'JavaScript',
		'Python',
		'React',
		'Node.js',
		'SQL',
		'AWS',
		'Docker',
		'Kubernetes'
	];
	const commonEducation = [
		"Bachelor's",
		"Master's",
		'PhD',
		'High School',
		"Associate's",
		'Certificate'
	];
	const commonPerformance = ['Excellent', 'Good', 'Average', 'Below Average', 'Needs Improvement'];
	const commonBenefits = [
		'Health Insurance',
		'Dental Insurance',
		'Vision Insurance',
		'401k',
		'Stock Options',
		'PTO'
	];

	const stream = new ReadableStream({
		start(controller) {
			let i = 0;

			function push() {
				const batchSize = 10000; // tune batch to balance throughput and responsiveness
				const end = Math.min(i + batchSize, rows);
				for (; i < end; i++) {
					/** @type {Record<string, string>} */
					const obj = {};
					for (let k = 0; k < keys.length; k++) {
						const key = keys[k];

						// Generate values with repeated strings for testing interning
						let value;
						if (key === 'Department') {
							value = commonDepartments[i % commonDepartments.length];
						} else if (key === 'Position') {
							value = commonPositions[i % commonPositions.length];
						} else if (key === 'Status') {
							value = commonStatuses[i % commonStatuses.length];
						} else if (key === 'Location') {
							value = commonLocations[i % commonLocations.length];
						} else if (key === 'Skills') {
							value = commonSkills[i % commonSkills.length];
						} else if (key === 'Education') {
							value = commonEducation[i % commonEducation.length];
						} else if (key === 'Performance') {
							value = commonPerformance[i % commonPerformance.length];
						} else if (key === 'Benefits') {
							value = commonBenefits[i % commonBenefits.length];
						} else if (key === 'ID') {
							value = `EMP-${String(i + 1).padStart(6, '0')}`;
						} else if (key === 'Name') {
							value = `Employee ${i + 1}`;
						} else if (key === 'Email') {
							value = `employee${i + 1}@company.com`;
						} else if (key === 'Phone') {
							value = `+1-555-${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
						} else if (key === 'Salary') {
							value = `$${Math.floor(Math.random() * 100000) + 30000}`;
						} else if (key === 'HireDate') {
							value = `202${Math.floor(Math.random() * 4)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
						} else {
							// For other fields, use a mix of repeated and unique values
							if (Math.random() < 0.3) {
								// 30% chance of using a repeated value
								const repeatedValues = [
									'N/A',
									'Pending',
									'Not Specified',
									'TBD',
									'Under Review',
									'Approved',
									'Rejected'
								];
								value = repeatedValues[i % repeatedValues.length];
							} else {
								// 70% chance of unique value
								value = `Row ${i + 1} - ${key} - ${Math.random().toString(36).slice(2, 8)}`;
							}
						}

						obj[key] = value;
					}
					const line = JSON.stringify(obj) + '\n';
					controller.enqueue(encoder.encode(line));
				}
				if (i < rows) {
					// yield back to event loop so we don't monopolize CPU
					setTimeout(push, 0);
				} else {
					controller.close();
				}
			}

			push();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson'
		}
	});
}
