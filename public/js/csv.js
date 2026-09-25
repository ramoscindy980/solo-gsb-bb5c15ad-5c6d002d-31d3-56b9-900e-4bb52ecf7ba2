/*
 * csv.js —— 批量校样 CSV 解析（无 DOM 依赖，可在浏览器与 Node 中运行）
 *
 * 解析含表头 title,zh,en 的 CSV：
 *   - 字段可用双引号包裹，引号内允许逗号与换行；引号内两个双引号（""）转义为一个；
 *   - 行结束符 \r\n / \n / \r 均可；忽略 BOM 与完全空白的行；
 *   - 第 1 行须恰好为 title,zh,en 三列（忽略大小写与两侧空白，顺序不限）；
 *   - 数据记录最多 20 条，逐条校验：列数须为 3，标题（title）与中文正文（zh）
 *     必填，英文译文（en）可留空；校验错误定位到记录号（数据第 1 条起编号）。
 */
(function (global) {
  'use strict';

  var MAX_RECORDS = 20;            // 批量校样记录数上限
  var HEADER_NAMES = ['title', 'zh', 'en'];

  // 通用 CSV 解析 → 行数组（每行为字段数组）。
  // 引号仅在字段起始处生效；字段中间的引号按字面保留；
  // 引号字段闭合后至分隔符之间的字符宽松地并入该字段。
  function parseCsv(text) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // 忽略 BOM
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = s.length;
    while (i < n) {
      var c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; } // "" → 字面 "
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue; // 引号内允许逗号与换行
      }
      if (c === '"' && field === '') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
        if (c === '\r' && s[i + 1] === '\n') i += 2; else i++;
        continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /**
   * 解析批量校样 CSV。
   * @param {string} raw 粘贴的 CSV 全文
   * @returns {{fatal:string|null, total:number,
   *            records:Array<{no:number, ok:boolean, error:string|null,
   *                           title:string, zh:string, en:string}>}}
   *   fatal 非空：整体无法解析（空内容/表头错误/无数据/超过 20 条），records 为空；
   *   否则 records 逐条给出校验结果，ok=false 时 error 为定位到记录号的原因。
   *   title/zh/en 保留原始文本（含字段内换行），必填判断按去空白后的文本进行。
   */
  function parseBatch(raw) {
    var empty = { fatal: null, total: 0, records: [] };
    var text = String(raw == null ? '' : raw);
    if (!text.trim()) {
      empty.fatal = '请粘贴含表头 title,zh,en 的 CSV 内容。';
      return empty;
    }
    var rows = parseCsv(text).filter(function (r) {
      return !(r.length === 1 && r[0].trim() === ''); // 忽略完全空白的行
    });
    if (!rows.length) {
      empty.fatal = 'CSV 内容为空：请粘贴含表头 title,zh,en 的 CSV。';
      return empty;
    }

    // 表头：恰好 title,zh,en 三列（忽略大小写与两侧空白，顺序不限）
    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var colOf = {};
    var headerBad = null;
    if (header.length !== HEADER_NAMES.length) {
      headerBad = '表头（第 1 行）共 ' + header.length + ' 列，需恰好为 ' +
        HEADER_NAMES.join(',') + ' 三列';
    } else {
      for (var k = 0; k < HEADER_NAMES.length; k++) {
        var name = HEADER_NAMES[k];
        var first = header.indexOf(name);
        if (first < 0) {
          headerBad = '表头（第 1 行）缺少「' + name + '」列，需恰好为 ' +
            HEADER_NAMES.join(',') + ' 三列（顺序不限）';
          break;
        }
        if (header.indexOf(name, first + 1) >= 0) {
          headerBad = '表头（第 1 行）「' + name + '」列重复出现';
          break;
        }
        colOf[name] = first;
      }
    }
    if (headerBad) {
      empty.fatal = headerBad + '；当前表头为「' + rows[0].join(',') + '」。';
      return empty;
    }

    var dataRows = rows.slice(1);
    if (!dataRows.length) {
      empty.fatal = 'CSV 只有表头，没有数据记录。';
      return empty;
    }
    if (dataRows.length > MAX_RECORDS) {
      empty.fatal = '共 ' + dataRows.length + ' 条数据记录，超过上限 ' +
        MAX_RECORDS + ' 条，请删减后重新粘贴。';
      return empty;
    }

    var records = dataRows.map(function (r, idx) {
      var no = idx + 1; // 记录号：数据第 1 条起编号（不含表头）
      if (r.length !== HEADER_NAMES.length) {
        return {
          no: no, ok: false, title: '', zh: '', en: '',
          error: '第 ' + no + ' 条记录共 ' + r.length + ' 列，应为 3 列（' +
            HEADER_NAMES.join(',') + '）；含逗号或换行的字段需用双引号包裹。'
        };
      }
      var title = r[colOf.title];
      var zh = r[colOf.zh];
      var en = r[colOf.en];
      if (!title.trim()) {
        return {
          no: no, ok: false, title: title, zh: zh, en: en,
          error: '第 ' + no + ' 条记录缺少必填的标题（title）。'
        };
      }
      if (!zh.trim()) {
        return {
          no: no, ok: false, title: title, zh: zh, en: en,
          error: '第 ' + no + ' 条记录缺少必填的中文正文（zh）。'
        };
      }
      return { no: no, ok: true, title: title, zh: zh, en: en, error: null };
    });
    return { fatal: null, total: records.length, records: records };
  }

  var api = {
    MAX_RECORDS: MAX_RECORDS,
    parseCsv: parseCsv,
    parseBatch: parseBatch
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LabelCsv = api;
})(typeof window !== 'undefined' ? window : globalThis);
