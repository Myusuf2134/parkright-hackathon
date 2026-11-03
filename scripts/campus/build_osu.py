#!/usr/bin/env python3
"""Regenerates the OSU campus file from OpenStreetMap. Run it, then review the diff before committing.

    python3 scripts/campus/build_osu.py

Coordinates, addresses and capacities are copied from the named OSM objects, never typed in by hand.
Vehicle entrances are amenity=parking_entrance nodes on the garage footprint (within 10 m, or 35 m if
the footprint has none, so a neighbouring garage's ramps aren't claimed):
  inbound   a one-way driveway flows into the node
  mapped    an entrance is mapped but the direction of traffic there isn't known
  (a node that one-way driveways only flow out of is an exit, and is left out)
Pedestrian doors are entrance=* nodes on the footprint with a walkable way attached. Building doors are
entrance=* nodes on the building's own outline. Where none is mapped the list is empty and the app says so.
OSM is community data: nothing here has been surveyed on site.
"""
import json
import math
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

UA = {'User-Agent': 'Meridian-campus-data/0.1 (campus data build)'}
OUT = Path(__file__).resolve().parents[2] / 'apps/web/src/driver/maps/campus/osu.json'

# OSM way id, display name, short name, extra search terms
GARAGES = [
    (162877497, 'Ohio Union South Garage', 'Union South', 'ohio union parking'),
    (30172346, 'Ohio Union North Garage', 'Union North', 'ohio union parking'),
    (30172348, 'Arps Garage', 'Arps', '18th college road'),
    (38911610, 'Tuttle Park Place Garage', 'Tuttle', 'tuttle garage ives'),
    (158734277, 'Lane Avenue Garage', 'Lane Avenue', 'neil lane'),
    (162932157, 'Neil Avenue Garage', 'Neil Avenue', 'neil'),
    (369601354, '9th Avenue East Garage', '9th East', 'ninth medical'),
    (369601355, '9th Avenue West Garage', '9th West', 'ninth medical'),
    (373547727, '11th Avenue Garage', '11th Avenue', 'eleventh'),
    (373704487, '12th Avenue Garage', '12th Avenue', 'twelfth medical'),
    (326172610, 'Gateway Garage', 'Gateway', 'south campus high'),
    (38911612, 'Northwest Garage', 'Northwest', ''),
    (396827340, 'West Lane Garage', 'West Lane', 'lane'),
    (162932204, 'SafeAuto Hospitals Garage', 'SafeAuto', 'hospital medical'),
    (732445629, 'Wexner Medical Center Garage', 'Wexner Medical', 'hospital'),
]
# OSM type+id, display name, short name, extra search terms
BUILDINGS = [
    ('W300842706', 'Dreese Laboratories', 'Dreese Labs', 'dreese ece computer science'),
    ('W30172308', 'Thompson Library', 'Thompson', 'main library oval'),
    ('W154204619', 'Ohio Union', 'Ohio Union', 'student union'),
    ('W119153498', 'Ohio Stadium', 'Stadium', 'horseshoe football'),
    ('W48208477', 'RPAC', 'RPAC', 'recreation physical activity gym'),
    ('W154204443', 'Hitchcock Hall', 'Hitchcock', 'engineering'),
    ('R2075433', 'Scott Laboratory', 'Scott Lab', 'mechanical engineering'),
    ('R8663659', 'Knowlton Hall', 'Knowlton', 'architecture'),
    ('W154204210', 'Baker Systems Engineering', 'Baker Systems', 'engineering'),
    ('W158681433', 'Caldwell Laboratory', 'Caldwell', 'computer science'),
    ('W154204609', 'Mendenhall Laboratory', 'Mendenhall', 'geology'),
    ('W154204575', 'McPherson Chemical Laboratory', 'McPherson', 'chemistry'),
    ('W154204675', 'Sullivant Hall', 'Sullivant', ''),
    ('W537538847', 'Wexner Center for the Arts', 'Wexner Center', 'art museum'),
    ('W50058180', 'University Hall', 'University Hall', 'oval'),
    ('W154204806', '18th Avenue Library', '18th Ave Library', 'science engineering'),
    ('W373705613', 'Jennings Hall', 'Jennings', 'biology'),
    ('W154204611', 'Mershon Auditorium', 'Mershon', 'theatre'),
    ('W154204627', 'Pomerene Hall', 'Pomerene', ''),
    ('W154204218', 'Bolz Hall', 'Bolz', 'engineering'),
    ('W154204363', 'Enarson Classroom Building', 'Enarson', 'classroom'),
    ('W154204714', 'Physics Research Building', 'Physics Research', 'prb'),
]


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def tags(el):
    return {t.get('k'): t.get('v') for t in el.findall('tag')}


def metres(a, b):
    k = math.cos(math.radians(a[0]))
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * k)


def to_ring(point, ring):
    return min(metres(point, p) for p in ring)


def lookup(ids):
    out = {}
    for i in range(0, len(ids), 40):
        q = urllib.parse.urlencode({'osm_ids': ','.join(ids[i:i + 40]), 'format': 'jsonv2', 'addressdetails': 1})
        for e in json.loads(get(f'https://nominatim.openstreetmap.org/lookup?{q}')):
            out[f"{e['osm_type'][0].upper()}{e['osm_id']}"] = e
        time.sleep(1.1)
    return out


def street_address(e):
    a = e.get('address', {})
    line = ' '.join(x for x in [a.get('house_number'), a.get('road')] if x)
    return line or None


FOOT = ('footway', 'steps', 'path', 'corridor', 'pedestrian', 'living_street')


def side_of(p, centre):
    k = math.cos(math.radians(centre[0]))
    dy, dx = p[0] - centre[0], (p[1] - centre[1]) * k
    if abs(dx) >= abs(dy):
        return 'east' if dx > 0 else 'west'
    return 'north' if dy > 0 else 'south'


def building_doors(ref):
    kind = {'W': 'way', 'R': 'relation'}.get(ref[0])
    if not kind:
        return []
    root = ET.fromstring(get(f'https://api.openstreetmap.org/api/0.6/{kind}/{ref[1:]}/full'))
    doors = []
    for n in root.findall('node'):
        t = tags(n)
        if t.get('entrance') and t['entrance'] not in ('no', 'emergency', 'service', 'exit') and t.get('access') not in ('private', 'no'):
            doors.append({'lat': float(n.get('lat')), 'lng': float(n.get('lon')), 'osmNode': int(n.get('id'))})
    return doors


def garage_record(way_id, name, short, terms, place):
    root = ET.fromstring(get(f'https://api.openstreetmap.org/api/0.6/way/{way_id}/full'))
    nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in root.findall('node')}
    way = next(w for w in root.findall('way') if w.get('id') == str(way_id))
    t = tags(way)
    ring = [nodes[n.get('ref')] for n in way.findall('nd')]
    lat, lon = (sum(p[i] for p in ring) / len(ring) for i in (0, 1))
    d = 0.0012 + max(abs(p[0] - lat) for p in ring)
    area = ET.fromstring(get(f'https://api.openstreetmap.org/api/0.6/map?bbox={lon - d * 1.3},{lat - d},{lon + d * 1.3},{lat + d}'))
    all_nodes = {n.get('id'): n for n in area.findall('node')}
    pos = lambda n: (float(n.get('lat')), float(n.get('lon')))
    road_ways = []
    for w in area.findall('way'):
        wt = tags(w)
        if 'highway' in wt:
            road_ways.append((wt, [x.get('ref') for x in w.findall('nd')]))
    found = []
    doors = []
    for nid, n in all_nodes.items():
        nt = tags(n)
        p = pos(n)
        gap = to_ring(p, ring)
        walkable = any(nid in refs and (wt['highway'] in FOOT or wt.get('foot') in ('yes', 'designated')) for wt, refs in road_ways)
        if nt.get('entrance') and nt.get('amenity') != 'parking_entrance' and nt['entrance'] not in ('no', 'emergency', 'service') and nt.get('access') not in ('private', 'no') and gap <= 4 and walkable:
            doors.append({'lat': round(p[0], 7), 'lng': round(p[1], 7), 'osmNode': int(nid), 'side': side_of(p, (lat, lon))})
        if nt.get('amenity') != 'parking_entrance' or nt.get('access') in ('private', 'no') or gap > 35:
            continue
        into = out = roads = 0
        for wt, refs in road_ways:
            if nid not in refs or wt['highway'] in FOOT or wt['highway'] == 'cycleway':
                continue
            roads += 1
            if wt.get('oneway') == 'yes':
                into += refs[-1] == nid
                out += refs[0] == nid
            elif wt.get('oneway') == '-1':
                into += refs[0] == nid
                out += refs[-1] == nid
        if not roads or (out and not into):
            continue
        found.append({'lat': round(p[0], 7), 'lng': round(p[1], 7), 'osmNode': int(nid), 'kind': 'inbound' if into else 'mapped', 'side': side_of(p, (lat, lon)), 'maxHeight': nt.get('maxheight'), 'gapMetres': round(gap)})
    close = [e for e in found if e['gapMetres'] <= 10]
    entrances = sorted(close or found, key=lambda e: (e['kind'] != 'inbound', e['gapMetres'], e['osmNode']))
    for e in entrances:
        del e['gapMetres']
    doors.sort(key=lambda e: e['osmNode'])
    capacity = t.get('capacity')
    return {
        'id': f'osu-{short.lower().replace(" ", "-")}',
        'name': name, 'short': short, 'terms': terms, 'osm': f'way/{way_id}',
        'lat': round(lat, 7), 'lng': round(lon, 7),
        'address': street_address(place) if place else None,
        'capacity': int(capacity) if capacity and capacity.isdigit() else None,
        'osmOperator': t.get('operator'),
        'entrances': entrances, 'pedestrianDoors': doors,
        'footprint': [[round(p[1], 7), round(p[0], 7)] for p in ring],
    }


def main():
    places = lookup([f'W{g[0]}' for g in GARAGES] + [b[0] for b in BUILDINGS])
    garages = []
    for g in GARAGES:
        garages.append(garage_record(*g, places.get(f'W{g[0]}')))
        time.sleep(1)
    buildings = []
    for ref, name, short, terms in BUILDINGS:
        e = places[ref]
        kind = {'W': 'way', 'R': 'relation', 'N': 'node'}[ref[0]]
        buildings.append({
            'id': f'osu-b-{short.lower().replace(" ", "-")}', 'name': name, 'short': short, 'terms': terms,
            'osm': f'{kind}/{ref[1:]}', 'lat': round(float(e['lat']), 7), 'lng': round(float(e['lon']), 7), 'address': street_address(e),
            'doors': building_doors(ref),
        })
        time.sleep(0.4)
    OUT.write_text(json.dumps({'source': 'OpenStreetMap contributors (ODbL)', 'retrieved': date.today().isoformat(), 'garages': garages, 'buildings': buildings}, indent=1) + '\n')
    for g in garages:
        print(f"{g['name']:32} cap={g['capacity']} entrances={[(e['kind'], e['side'], e['osmNode']) for e in g['entrances']]} doors={[(d['side'], d['osmNode']) for d in g['pedestrianDoors']]}")
    for b in buildings:
        print(f"{b['name']:32} doors={len(b['doors'])}")


if __name__ == '__main__':
    main()
