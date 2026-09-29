import { Bird, Building2, Landmark, MapPin, Mountain, Palmtree, Tent, TrainFront, Trees, Utensils, Waves, Camera, Bike, Sailboat } from 'lucide-react';

/** Íconos permitidos para categorías (el admin elige de esta lista: reconocer en vez de recordar). */
export const CATEGORY_ICONS = {
  trees: Trees,
  mountain: Mountain,
  landmark: Landmark,
  bird: Bird,
  waves: Waves,
  'building-2': Building2,
  'train-front': TrainFront,
  utensils: Utensils,
  palmtree: Palmtree,
  tent: Tent,
  camera: Camera,
  bike: Bike,
  sailboat: Sailboat,
  'map-pin': MapPin,
};

export const CategoryIcon = ({ name, size = 20, ...rest }) => {
  const Icon = CATEGORY_ICONS[name] ?? MapPin;
  return <Icon size={size} aria-hidden="true" {...rest} />;
};
