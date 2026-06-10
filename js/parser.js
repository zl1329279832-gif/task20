/* ===== CSV/JSON 解析器模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Parser = {
    FIELD_MAPS: {
        building: { building_id: ['building_id','楼栋ID','楼栋编号','buildingId'], building_name: ['building_name','楼栋名称','名称'], location: ['location','位置','地址'], floors: ['floors','楼层数','总楼层','floor_count'], area: ['area','面积','建筑面积'] },
        floor: { floor_id: ['floor_id','楼层ID','楼层编号'], building_id: ['building_id','楼栋ID','所属楼栋'], floor_number: ['floor_number','楼层号','层数','floor_num'], floor_name: ['floor_name','楼层名称','名称'] },
        room: { room_id: ['room_id','房间ID','房间编号'], floor_id: ['floor_id','楼层ID','所属楼层'], room_name: ['room_name','房间名称','名称'], room_type: ['room_type','房间类型','用途','type'], area: ['area','面积','room_area'] },
        device: { device_id: ['device_id','设备ID','设备编号'], device_name: ['device_name','设备名称','名称'], room_id: ['room_id','房间ID','所属房间'], device_type: ['device_type','设备类型','类型'], meter_id: ['meter_id','电表ID','电表编号'], rated_power: ['rated_power','额定功率','功率'] },
        meter_reading: { meter_id: ['meter_id','电表ID','电表编号'], timestamp: ['timestamp','时间','读数时间','datetime','date','reading_time'], reading: ['reading','读数','电表读数','value','kwh','energy'], power: ['power','功率','实时功率'] },
        ac_energy: { device_id: ['device_id','设备ID','空调ID','deviceId'], timestamp: ['timestamp','时间','记录时间','datetime','date'], energy: ['energy','能耗','用电量','consumption','kwh'], temperature: ['temperature','温度','设定温度','temp'], mode: ['mode','模式','运行模式'], runtime: ['runtime','运行时长','运行时间','hours'] },
        lighting_energy: { device_id: ['device_id','设备ID','照明ID','deviceId'], timestamp: ['timestamp','时间','记录时间','datetime','date'], energy: ['energy','能耗','用电量','consumption','kwh'], brightness: ['brightness','亮度','亮度等级','level'], runtime: ['runtime','运行时长','运行时间','hours'] },
        pricing: { pricing_id: ['pricing_id','电价ID','编号','id'], period_type: ['period_type','时段类型','时段','type','time_period'], start_time: ['start_time','开始时间','起始','from','start'], end_time: ['end_time','结束时间','终止','to','end'], price: ['price','电价','单价','unit_price','rate'], effective_date: ['effective_date','生效日期','生效时间','date'] }
    },

    parseCSV(text) {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return { headers: [], rows: [] };
        const delimiter = this._detectDelimiter(lines[0]);
        const headers = this._splitCSVLine(lines[0], delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            if (/^\s*(#|\/\/|--)/.test(lines[i])) continue;
            const values = this._splitCSVLine(lines[i], delimiter);
            if (values.length >= headers.length - 1) {
                const row = {};
                headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim().replace(/^["']|["']$/g, ''); });
                rows.push(row);
            }
        }
        return { headers, rows };
    },

    _detectDelimiter(line) {
        let best = ',', bestCount = 0;
        [',', '\t', ';', '|'].forEach(d => { const c = line.split(d).length - 1; if (c > bestCount) { bestCount = c; best = d; } });
        return best;
    },

    _splitCSVLine(line, delimiter) {
        const result = []; let current = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { if (inQuotes && line[i+1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
            else if (ch === delimiter && !inQuotes) { result.push(current); current = ''; }
            else current += ch;
        }
        result.push(current);
        return result;
    },

    mapFields(headers, dataType) {
        const fieldMap = this.FIELD_MAPS[dataType] || {};
        const mapping = {};
        Object.keys(fieldMap).forEach(field => {
            const aliases = fieldMap[field];
            let bestMatch = null, bestScore = 0;
            headers.forEach(header => {
                const h = header.toLowerCase().trim();
                for (const alias of aliases) {
                    const a = alias.toLowerCase();
                    if (h === a) { bestMatch = header; bestScore = 1; break; }
                    if (h.includes(a) || a.includes(h)) {
                        const score = Math.min(h.length, a.length) / Math.max(h.length, a.length);
                        if (score > bestScore) { bestMatch = header; bestScore = score; }
                    }
                }
            });
            if (bestMatch && bestScore >= 0.5) mapping[field] = { header: bestMatch, confidence: bestScore };
        });
        const mappedHeaders = new Set(Object.values(mapping).map(m => m.header));
        return { mapping, unmapped: headers.filter(h => !mappedHeaders.has(h)) };
    },

    parseFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const ext = file.name.split('.').pop().toLowerCase();
                    let result;
                    if (ext === 'json') {
                        const data = JSON.parse(e.target.result);
                        const arr = Array.isArray(data) ? data : (data.data || data.records || data.items || [data]);
                        const headers = arr.length ? Object.keys(arr[0]) : [];
                        result = { headers, rows: arr };
                    } else {
                        result = this.parseCSV(e.target.result);
                    }
                    resolve(result);
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsText(file, 'UTF-8');
        });
    }
};
