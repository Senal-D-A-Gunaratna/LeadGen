
import type { AttendanceHistoryData, Student } from "./types";

type StudentJson = {
    students: Omit<Student, 'status' | 'hasScannedToday' | 'lastScanTime' | 'attendanceHistory'>[];
};

type FlatStudent = {
    id: number;
    name: string;
    grade: number;
    className: string;
    role?: string;
    email: string;
    phone: string;
    fingerprint1: string;
    fingerprint2: string;
    fingerprint3: string;
    fingerprint4: string;
    specialRoles?: string;
    notes?: string;
};

/**
 * Converts a JSON object of student data into a CSV string.
 * @param jsonData The student data in JSON format.
 * @returns A string representing the data in CSV format.
 */
export function jsonToCsv(jsonData: StudentJson): string {
    const students = jsonData.students;
    if (!students || students.length === 0) {
        return "";
    }

    const headers = [
        "ID", "Name", "Grade", "Class_Name", "Role", 
        "Phone_Number", "Email_Adderss", 
        "Speciai_Roles", "Notes",
        "Fingerprint_1", "Fingerprint_2", "Fingerprint_3", "Fingerprint_4"
    ];
    
    const keyMapping: Record<string, keyof FlatStudent> = {
        "ID": "id",
        "Name": "name",
        "Grade": "grade",
        "Class_Name": "className",
        "Role": "role",
        "Phone_Number": "phone",
        "Email_Adderss": "email",
        "Fingerprint_1": "fingerprint1",
        "Fingerprint_2": "fingerprint2",
        "Fingerprint_3": "fingerprint3",
        "Fingerprint_4": "fingerprint4",
        "Speciai_Roles": "specialRoles",
        "Notes": "notes",
    };

    const flatStudents: FlatStudent[] = students.map(s => ({
        id: s.id,
        name: s.name,
        grade: s.grade,
        className: s.className,
        role: s.role || '',
        email: s.contact.email,
        phone: s.contact.phone,
        fingerprint1: s.fingerprints?.[0] || '',
        fingerprint2: s.fingerprints?.[1] || '',
        fingerprint3: s.fingerprints?.[2] || '',
        fingerprint4: s.fingerprints?.[3] || '',
        specialRoles: s.specialRoles || '',
        notes: s.notes || '',
    }));

    const headerRow = headers.join(',');
    const bodyRows = flatStudents.map(student =>
        headers.map(header => {
            const key = keyMapping[header];
            const value = student[key];
            // Handle values that might contain commas
            const stringValue = String(value ?? '');
            return stringValue.includes(',') ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
        }).join(',')
    ).join('\n');

    return `${headerRow}\n${bodyRows}`;
}


function parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuote && line[i + 1] === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuote = !inQuote;
            }
        } else if (char === ',' && !inQuote) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current);
    return values;
}

/**
 * Converts a CSV string of student data into a JSON object.
 * @param csvData The student data in CSV format as a string.
 * @returns A JSON object structured for the application.
 */
export function csvToJson(csvData: string): StudentJson {
    const lines = csvData.trim().split('\n').map(line => line.trim());
    if (lines.length < 2) {
        throw new Error("CSV must have a header and at least one row of data.");
    }
    
    const headerLine = lines.shift() as string;
    const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    const keyMapping: Record<string, string> = {
        "ID": "id",
        "Name": "name",
        "Grade": "grade",
        "Class_Name": "className",
        "Role": "role",
        "Phone_Number": "phone",
        "Email_Adderss": "email",
        "Fingerprint_1": "fingerprint1",
        "Fingerprint_2": "fingerprint2",
        "Fingerprint_3": "fingerprint3",
        "Fingerprint_4": "fingerprint4",
        "Speciai_Roles": "specialRoles",
        "Notes": "notes",
    };
    
    const normalizedHeaders = headers.map(h => keyMapping[h] || h);

    const requiredHeaders = ["id", "name", "grade", "className"];
    for (const requiredHeader of requiredHeaders) {
        if (!normalizedHeaders.includes(requiredHeader)) {
            throw new Error(`CSV is missing required header: ${requiredHeader}`);
        }
    }

    const students = lines.map(line => {
        if (!line) return null;
        
        const values = parseCsvLine(line);
        
        const studentObject: any = {};
        normalizedHeaders.forEach((header, index) => {
            studentObject[header] = values[index] || '';
        });

        const id = parseInt(studentObject.id, 10);
        const grade = parseInt(studentObject.grade, 10);
        if (isNaN(id) || isNaN(grade)) {
            console.warn(`Skipping line with invalid 'id' or 'grade': ${line}`);
            return null;
        }

        return {
            id: id,
            name: studentObject.name || '',
            grade: grade,
            className: studentObject.className || '',

            role: studentObject.role || undefined,
            contact: {
                email: studentObject.email || '',
                phone: studentObject.phone || '',
            },
            fingerprints: [
                studentObject.fingerprint1 || '', 
                studentObject.fingerprint2 || '', 
                studentObject.fingerprint3 || '', 
                studentObject.fingerprint4 || ''
            ] as [string, string, string, string],
            specialRoles: studentObject.specialRoles || '',
            notes: studentObject.notes || '',
        };
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    return { students };
}


/**
 * Converts a JSON object of attendance history into a CSV string, including student names.
 * @param jsonData The attendance data in JSON format.
 * @param students The array of all students to look up names.
 * @returns A string representing the data in CSV format.
 */
export function attendanceJsonToCsv(jsonData: AttendanceHistoryData, students: Student[]): string {
    const headers = ["Student ID", "Name", "Date", "Status"];
    const rows: string[] = [];
    const studentMap = new Map(students.map(s => [s.id, s.name]));

    for (const studentId in jsonData) {
        if (Object.prototype.hasOwnProperty.call(jsonData, studentId)) {
            const records = jsonData[studentId];
            const name = studentMap.get(parseInt(studentId, 10)) || 'Unknown Student';
            for (const record of records) {
                // Handle potential commas in name
                const csvName = name.includes(',') ? `"${name}"` : name;
                rows.push([studentId, csvName, record.date, record.status].join(','));
            }
        }
    }

    return `${headers.join(',')}\n${rows.join('\n')}`;
}

/**
 * Converts a CSV string of attendance history into a JSON object.
 * It ignores the 'name' column, using only 'studentId' for mapping.
 * @param csvData The attendance data in CSV format as a string.
 * @returns A JSON object structured for the application.
 */
export function attendanceCsvToJson(csvData: string): AttendanceHistoryData {
    const lines = csvData.trim().split('\n').map(line => line.trim());
    if (lines.length < 2) {
        return {}; // Return empty object for empty or header-only file
    }
    const headerLine = lines.shift()!;
    const headers = parseCsvLine(headerLine).map(h => h.trim().replace(/"/g, ''));
    
    const studentIdHeader = "Student ID";
    const dateHeader = "Date";
    const statusHeader = "Status";

    const requiredHeaders = [studentIdHeader, dateHeader, statusHeader];

    for (const requiredHeader of requiredHeaders) {
        if (!headers.includes(requiredHeader)) {
            throw new Error(`CSV must include the following headers: "${requiredHeaders.join('", "')}"`);
        }
    }
    
    const studentIdIndex = headers.indexOf(studentIdHeader);
    const dateIndex = headers.indexOf(dateHeader);
    const statusIndex = headers.indexOf(statusHeader);

    const jsonData: AttendanceHistoryData = {};

    lines.forEach(line => {
        if (!line) return; // Skip empty lines
        const values = parseCsvLine(line);
        
        const studentId = values[studentIdIndex];
        const date = values[dateIndex];
        const status = values[statusIndex];

        if (!studentId || !date || !status) return; // Skip incomplete lines

        if (!jsonData[studentId]) {
            jsonData[studentId] = [];
        }
        jsonData[studentId].push({ date, status: status as any });
    });

    // Sort each student's history by date, descending
    for (const studentId in jsonData) {
        jsonData[studentId].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    return jsonData;
}

    
