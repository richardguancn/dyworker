import React, { useState } from 'react';
import { DataComponent, DataTable, EvidenceChart, Dropdown, SegmentedControl, Slider, Switch, useDataApp } from '../../data-app-public.jsx';
import './print-fixture.css';

const columns = [{field:'account',label:'Account'}, {field:'region',label:'Region'}, {field:'users',label:'Users'}, {field:'status',label:'Status',presentation:'status'}, {field:'history',label:'Trend',presentation:'sparkline'}];
export function DashboardContent() {
  const { queries } = useDataApp();
  const records = queries.records.rows;
  const [region,setRegion] = useState('All');
  const [measure,setMeasure] = useState('users');
  const [lift,setLift] = useState(10);
  const [enabled,setEnabled] = useState(true);
  const [selected,setSelected] = useState(null);
  const scoped = records.filter(r=>region==='All'||r.region===region);
  const table = (id,title,rows,props={}) => <DataComponent key={id} id={id} queryId="records" title={title} kind="table" variant="card" sourceRows={rows} displayRows={rows}>
    <DataTable rows={rows} columns={columns} label={title} {...props}/>
  </DataComponent>;
  return <article className="print-fixture">
    <h1>PDF export test dashboard</h1>
    <p className="fixture-context">Synthetic test data · September 2026 · Current rendered view</p>
    {table('short-table','Two-row summary',records.slice(0,2))}
    {table('records-table','Account records',scoped,{rowKey:'account',selectedRowKey:selected,onRowSelect:r=>setSelected(r.account),toolbarControls:<Dropdown label="Region" showLabel value={region} choices={['All','East','West']} onChange={setRegion}/>})}
    {selected && <p className="fixture-context">Selected account: {selected}</p>}
    {table('receipt-table','Receipt pagination',records,{paginationStyle:'receipt'})}
    <div className="fixture-pair">
      <DataComponent id="scenario" queryId="trend" title="Scenario assumption" kind="custom" variant="card" sourceRows={queries.trend.rows} displayRows={queries.trend.rows}>
        <Slider label="Assumed lift" min={0} max={30} value={lift} onChange={setLift} formatValue={v=>`${v}%`} />
        <p>Scenario multiplier: {(1+lift/100).toFixed(2)}</p>
      </DataComponent>
      <DataComponent id="switch" queryId="trend" title="Comparison setting" kind="custom" variant="card" sourceRows={queries.trend.rows} displayRows={queries.trend.rows}>
        <Switch label="Include target" checked={enabled} onChange={setEnabled}/>
        <p>{enabled ? 'Target included' : 'Target excluded'}</p>
      </DataComponent>
    </div>
    <EvidenceChart id="trend" queryId="trend" title="Weekly adoption" variant="card" rows={queries.trend.rows} sourceRows={queries.trend.rows} height={200}
      headerControls={<SegmentedControl ariaLabel="Measure" value={measure} onChange={setMeasure} options={[{value:'users',label:'Users'},{value:'target',label:'Target'}]}/>}
      spec={{type:'line',x:'week',y:measure,showLegend:false,showXAxisLabel:false}}/>
    <div className="fixture-pair">{['bar','horizontalBar','area','line'].map((type,i)=><EvidenceChart key={type} id={`chart-${i}`} queryId="trend" title={['Weekly volume','Volume by week','Adoption area','Users and target'][i]} variant="card" rows={queries.trend.rows} sourceRows={queries.trend.rows} height={180}
      spec={{type,x:'week',y:'users',fields:i===3?['users','target']:['users'],showLegend:i===3,showXAxisLabel:false}} />)}</div>
    {table('empty-table','Empty result',[],{searchable:false})}
    {table('long-label-table','Long labels and null values',[{account:'Account with a deliberately long descriptive name that must wrap in print',region:'East',users:null,status:'Unknown',history:[2,3,4]}],{searchable:false})}
  </article>;
}
