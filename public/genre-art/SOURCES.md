# Genre card photos: sources and licences

The four spoken-word genres (News, Talk, Sports, Public) have no album covers, so their Browse genre cards show the photos in this folder, published at `https://rrradio.org/genre-art/<genre>-<n>.jpg` and listed in [`genre-art.json`](../genre-art.json). Every photo comes from Wikimedia Commons and is marked there as **CC0** or **public domain**, with no attribution required and no restrictions listed. The file page is the record.

Each file is a centre-cropped 480 px square of the original. Photos were chosen to show no identifiable people; a brand name may be legible on a pictured object.

| File | Licence | Author (as given on Commons) | File page | Licence read |
|---|---|---|---|---|
| `news-1.jpg` | CC0 | Douglas W. Jones | <https://commons.wikimedia.org/wiki/File:Old_Threshers_Miehle_Press_Drum.jpg> | 2026-11-22 |
| `news-2.jpg` | Public domain | H. Wise & Co. | <https://commons.wikimedia.org/wiki/File:Flat-globe_map_of_the_world.jpg> | 2026-11-22 |
| `news-3.jpg` | Public domain | Marsupium | <https://commons.wikimedia.org/wiki/File:Darton_%26_Co._-_Darton%E2%80%99s_pocket_globe_-_Whipple_Wh.0076.jpg> | 2026-11-22 |
| `talk-1.jpg` | CC0 | Jonathan Velasquez | <https://commons.wikimedia.org/wiki/File:Silver_and_black_studio_microphone_condenser.jpg> | 2026-11-22 |
| `talk-2.jpg` | Public domain | Zzubnik | <https://commons.wikimedia.org/wiki/File:Microphone_studio.jpg> | 2026-11-22 |
| `talk-3.jpg` | CC0 | WillSpirit SBLN willspirit | <https://commons.wikimedia.org/wiki/File:Headphone_Microphone_Madrid_(Unsplash).jpg> | 2026-11-22 |
| `sports-1.jpg` | Public domain | Airman 1st Class Kerelin Molina | <https://commons.wikimedia.org/wiki/File:Basketball_through_hoop.jpg> | 2026-11-22 |
| `sports-2.jpg` | CC0 | Waka77 | <https://commons.wikimedia.org/wiki/File:Incheon_Soccer_Stadium_4.JPG> | 2026-11-22 |
| `sports-3.jpg` | CC0 | Digitura | <https://commons.wikimedia.org/wiki/File:Football_stadium_early_1980s.jpg> | 2026-11-22 |
| `public-1.jpg` | CC0 | AVDLCZ | <https://commons.wikimedia.org/wiki/File:Katrin_Radio_Tower.jpg> | 2026-11-22 |
| `public-2.jpg` | CC0 | Daderot | <https://commons.wikimedia.org/wiki/File:Radio_receiver,_transistor,_AGA,_1960s,_TeM48048_-_Tekniska_museet_-_Stockholm,_Sweden_-_DSC01588.JPG> | 2026-11-22 |
| `public-3.jpg` | CC0 | acopbc | <https://commons.wikimedia.org/wiki/File:Radio_tower,_Japan;_May_2016_(01).jpg> | 2026-11-22 |

## Adding or replacing a photo

1. Pick a file on Wikimedia Commons whose page says **CC0** or **public domain**. No other licence is accepted. No identifiable people.
2. Crop it to a centred square, 480 to 600 px, and save it here as `<genre>-<n>.jpg`.
3. Add a row to the table above. The Licence cell must read exactly `CC0` or `Public domain`.
4. Reference it in `data/genre-art.yaml`, run `npm run genre-art` and commit the photo, this file, the YAML and `public/genre-art.json`.

`npm run check-genre-art` (CI) fails for a photo without a row here, a row with another licence, or a picture that is not a 480 to 600 px square.

Album covers on the music genre cards are not hosted here. They are linked from Apple's artwork servers; see `docs/spec/contracts/genre-art.md`.
